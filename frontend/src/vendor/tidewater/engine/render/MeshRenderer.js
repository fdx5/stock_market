import { GPU } from '../gpu/GPU.js';
import { BoundedCache } from '../gpu/BoundedCache.js';
import { composeShader, composeShaderAsync, createShaderModule, getBindGroupLayout, group0ForBlock, stripUnusedFunctions } from '../gpu/Shader.js';
import { buildMeshShader } from './MeshShader.js';
import { blendState } from './Material.js';
import { SceneLighting } from './wgsl/lighting.js';
import { FrameUniforms } from './Frame.js';
import { Frustum, Matrix4, Sphere, Vector3 } from '../math/index.js';

// Draws scene meshes: geometry upload, pipeline cache, per-draw uniforms, culling and sorting.
//
//   meshRenderer.render( scene, {
//     camera,                         // culling + sorting (its view must match frameBlock)
//     frameBlock: FrameUniforms,      // group 0 frame uniforms of this view
//     kind: 'main' | 'depth' | 'color', late: false,
//     colorViews: [ GPUTextureView... ], colorFormats: [ ... ], depthView, depthFormat,
//     clearColors: [ [ r, g, b, a ] | null ... ], clearDepth: 0 | 1 | null (null = load),
//     depthCompare: 'greater-equal',
//     layerMask: 1 << LAYER,
//     filter: ( object ) => bool,
//     after: ( pass ) => {}           // extra draws inside the same render pass (background, ...)
//   } );

const _sphere = new Sphere();
const _frustum = new Frustum();
const _vp = new Matrix4();
const _v = new Vector3();
const _camPos = new Vector3();

let _listToken = 0; // one per drawItems call (see BindingSet.getBindGroup)
const _sig = [];
const sharedPipelines = new BoundedCache(128, 3 * 1024 * 1024);
// (local modification) a number per GPU object, for the render-bundle keys
const _gpuIds = new WeakMap();
let _gpuNext = 1;
function _gpuId( x ) {

	if ( ! x ) return 0;
	let id = _gpuIds.get( x );
	if ( ! id ) _gpuIds.set( x, id = _gpuNext ++ );
	return id;

}
const layoutIds = new WeakMap();
let nextLayoutId = 0;
const layoutId = layout => {
	if ( ! layoutIds.has( layout ) ) layoutIds.set( layout, ++ nextLayoutId );
	return layoutIds.get( layout );
};

const DRAW_STRIDE = 256; // minUniformBufferOffsetAlignment
const DRAW_FLOATS = 40;

export class MeshRenderer {

	constructor() {

		this.pipelines = new Map();
		this.geometries = new Map();
		// Layouts belong to the mesh, not a cached vehicle geometry shared by every
		// selection. Otherwise old materials and instance arrays stay reachable.
		this.layouts = new WeakMap();
		this.capacity = 8192;
		this.drawBuffer = null;
		this.drawData = null;
		this.drawCount = 0;
		this.frame = - 1;
		this.stats = { draws: 0, triangles: 0, pipelines: 0 };
		this.drawLayout = null;
		this.drawBindGroup = null;
		// true: a draw compiles its pipeline on the spot (one-off bakes, portraits, tests); the engine's
		// scene renderer sets false: pipelines compile in the background and a draw is skipped until
		// its pipeline is ready (no first-use stalls)
		this.syncPipelines = true;

	}

	_ensureDrawBuffer() {

		if ( this.drawBuffer && this.drawData.byteLength >= this.capacity * DRAW_STRIDE ) return;
		if ( this.drawBuffer ) this.drawBuffer.destroy();
		this.drawBuffer = GPU.device.createBuffer( { label: 'draws', size: this.capacity * DRAW_STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST } );
		this.drawData = new Float32Array( this.capacity * DRAW_STRIDE / 4 );
		this.drawLayout = getBindGroupLayout( [ { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: DRAW_FLOATS * 4 } } ], 'draw' );
		this.drawBindGroup = GPU.device.createBindGroup( { label: 'draws', layout: this.drawLayout, entries: [ { binding: 0, resource: { buffer: this.drawBuffer, size: DRAW_FLOATS * 4 } } ] } );

	}

	_beginFrame() {

		if ( this.frame === GPU.frame ) return;
		this.frame = GPU.frame;
		this._ensureDrawBuffer();
		// (bundles: slots kept by their objects, freed after a few seconds unused)
		if ( this.bundles && this._slotRecs && GPU.frame % 120 === 0 ) {

			for ( let i = 0; i < this._slotRecs.length; i ++ ) {

				const rec = this._slotRecs[ i ];
				if ( rec && GPU.frame - rec.frame > 240 ) { rec.slot = - 1; this._slotRecs[ i ] = null; this._freeSlots.push( i ); }

			}

		}

		// grow for next frame if this one came close
		if ( Math.max( this.drawCount, this._slotTop ?? 0 ) > this.capacity * 0.75 ) {

			this.capacity *= 2;
			this._ensureDrawBuffer();

		}

		this.drawCount = 0;
		this._dirtyDrawStart = Infinity; this._dirtyDrawEnd = 0;
		GPU.onSubmit( () => {

			if ( this.dirtyDrawUploads && this.bundles ) {
				if ( this._dirtyDrawEnd > this._dirtyDrawStart ) {
					const offset = this._dirtyDrawStart * DRAW_STRIDE;
					GPU.queue.writeBuffer( this.drawBuffer, offset, this.drawData.buffer, offset, ( this._dirtyDrawEnd - this._dirtyDrawStart ) * DRAW_STRIDE );
				}
			} else if ( this.drawCount ) GPU.queue.writeBuffer( this.drawBuffer, 0, this.drawData.buffer, 0, this.drawCount * DRAW_STRIDE );

		} );
		this.stats.draws = 0;
		this.stats.triangles = 0;
		this.stats.bundleBuilds = this.stats.bundleEncodedDraws = 0;

	}

	// per-object slot in this frame's draw buffer (shared by every pass that draws it this frame)
	_slot( obj ) {

		let g = obj.__draw;
		if ( ! g ) g = obj.__draw = { frame: - 1, slot: - 1, cur: new Float32Array( 16 ), prev: new Float32Array( 16 ), has: false };
		if ( g.frame === GPU.frame ) return g.slot;
		if ( this.bundles ) {

			// (local modification) a slot of its own while it is drawn: a recorded bundle carries its
			// draws' slots, and slots by draw order moved whenever culling changed the order
			if ( g.slot < 0 || g.owner !== this ) {

				this._freeSlots ??= []; this._slotRecs ??= []; this._slotTop ??= 0;
				g.slot = this._freeSlots.length ? this._freeSlots.pop() : this._slotTop ++;
				if ( g.slot >= this.capacity ) throw new Error( 'MeshRenderer: draw buffer full' );
				g.owner = this;
				this._slotRecs[ g.slot ] = g;

			}

			this.drawCount = Math.max( this.drawCount, g.slot + 1 );

		} else {

			if ( this.drawCount >= this.capacity ) throw new Error( 'MeshRenderer: draw buffer full' );
			g.slot = this.drawCount ++;

		}

		g.frame = GPU.frame;
		const version = obj.worldTransformVersion, p = obj.drawParams;
		if ( this.dirtyDrawUploads && this.bundles && version !== undefined && g.data === this.drawData && g.dataSlot === g.slot && g.version === version && g.prevVersion === version && ! obj.resetVelocity && g.staticVelocity === !! obj.staticVelocity && g.id === ( obj.id ?? 0 ) && g.paramHas === !! p && g.tailHas === !! ( p && p.length > 3 ) && g.p0 === ( p ? p[ 0 ] : 0 ) && g.p1 === ( p ? p[ 1 ] : 0 ) && g.p2 === ( p ? p[ 2 ] : 0 ) && g.p3 === ( p?.[ 3 ] ?? 0 ) && g.p4 === ( p?.[ 4 ] ?? 0 ) && g.p5 === ( p?.[ 5 ] ?? 0 ) && g.p6 === ( p?.[ 6 ] ?? 0 ) ) return g.slot;
		g.prevVersion = g.has && ! obj.resetVelocity ? g.version : version;
		g.version = version;
		const e = obj.matrixWorld.elements;
		if ( g.has && ! obj.resetVelocity ) g.prev.set( g.cur );
		else g.prev.set( e );
		g.cur.set( e );
		g.has = true;
		obj.resetVelocity = false;
		const o = g.slot * DRAW_STRIDE / 4;
		const d = this.drawData;
		d.set( g.cur, o );
		d.set( obj.staticVelocity ? g.cur : g.prev, o + 16 );
		d[ o + 32 ] = obj.id ?? 0;
		d[ o + 33 ] = p ? p[ 0 ] : 0;
		d[ o + 34 ] = p ? p[ 1 ] : 0;
		d[ o + 35 ] = p ? p[ 2 ] : 0;
		if ( p && p.length > 3 ) for ( let i = 0; i < 4; i ++ ) d[ o + 36 + i ] = p[ 3 + i ] ?? 0;
		g.data = d; g.dataSlot = g.slot; g.staticVelocity = !! obj.staticVelocity; g.id = obj.id ?? 0;
		g.paramHas = !! p; g.tailHas = !! ( p && p.length > 3 );
		g.p0 = p ? p[ 0 ] : 0; g.p1 = p ? p[ 1 ] : 0; g.p2 = p ? p[ 2 ] : 0; g.p3 = p?.[ 3 ] ?? 0; g.p4 = p?.[ 4 ] ?? 0; g.p5 = p?.[ 5 ] ?? 0; g.p6 = p?.[ 6 ] ?? 0;
		this._dirtyDrawStart = Math.min( this._dirtyDrawStart, g.slot ); this._dirtyDrawEnd = Math.max( this._dirtyDrawEnd, g.slot + 1 );
		return g.slot;

	}

	// ------------------------------------------------------------------------------ geometry

	_geometryGPU( geometry ) {

		let g = this.geometries.get( geometry );
		if ( ! g ) {

			g = { buffers: new Map(), index: null, indexVersion: - 1 };
			this.geometries.set( geometry, g );
			g.onDispose = () => this.releaseGeometry( geometry );
			geometry.addEventListener?.( 'dispose', g.onDispose );

		}

		return g;

	}

	// CPU geometry may be cached across views, while GPU buffers belong to this
	// renderer. Reconcile only when meshes enter/leave the scene, not every frame.
	retainGeometry( objects ) {
		// Scratch draw rows must not retain a previous complex's buffers/materials.
		this._drawRows = [];
		this._collectPools = [];

		const used = new Map();
		for ( const o of objects ) {
			let attrs = used.get( o.geometry );
			if ( ! attrs ) {
				attrs = new Set( Object.values( o.geometry.attributes ).map( a => a.isInterleavedBufferAttribute ? a.data : a ) );
				used.set( o.geometry, attrs );
			}
			if ( o.isInstancedMesh ) {
				attrs.add( o.instanceMatrix );
				if ( o.instanceColor ) attrs.add( o.instanceColor );
			}
		}
		for ( const [ geometry, g ] of this.geometries ) {
			const attrs = used.get( geometry );
			if ( ! attrs ) { this.releaseGeometry( geometry ); continue; }
			for ( const [ src, b ] of g.buffers ) if ( ! attrs.has( src ) ) {
				b.buffer.destroy();
				g.buffers.delete( src );
			}
		}

	}

	releaseGeometry( geometry ) {

		const g = this.geometries.get( geometry );
		if ( ! g ) return;
		geometry.removeEventListener?.( 'dispose', g.onDispose );
		for ( const b of g.buffers.values() ) b.buffer.destroy();
		g.index?.buffer.destroy();
		this.geometries.delete( geometry );

	}

	dispose() {
		this.disposed = true;
		this._drawRows = [];
		this._collectPools = [];
		this._bundles?.clear();

		for ( const geometry of this.geometries.keys() ) this.releaseGeometry( geometry );
		this.drawBuffer?.destroy();
		this.drawBuffer = null;
		this.drawData = null;
		this.layouts = new WeakMap();
		this.pipelines.clear();

	}

	// GPU buffer for an attribute (or its interleaved buffer)
	_attributeBuffer( geometry, attr ) {

		const g = this._geometryGPU( geometry );
		const src = attr.isInterleavedBufferAttribute ? attr.data : attr;
		if ( src.gpuBuffer ) return src.gpuBuffer.getGPU ? src.gpuBuffer.getGPU() : src.gpuBuffer; // storage-backed attribute
		let b = g.buffers.get( src );
		const version = src.version ?? 0;
		// unchanged since the last upload (same array, same version)
		if ( b && b.version === version && b.array === src.array ) return b.buffer;
		const conv = convertArray( attr );
		if ( ! b || b.size < conv.byteLength ) {

			if ( b ) b.buffer.destroy();
			b = { buffer: GPU.device.createBuffer( { label: attr.name || 'attribute', size: Math.max( 16, align4( conv.byteLength ) ), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST } ), size: conv.byteLength, version: - 1 };
			g.buffers.set( src, b );

		}

		if ( b.version !== version || b.array !== src.array ) {

			const range = src.updateRanges && src.updateRanges.length && b.version >= 0 && b.array === src.array ? src.updateRanges : null;
			if ( range && conv === src.array ) {

				const bpe = src.array.BYTES_PER_ELEMENT;
				for ( const r of range ) GPU.queue.writeBuffer( b.buffer, r.start * bpe, src.array.buffer, src.array.byteOffset + r.start * bpe, align4( r.count * bpe ) );
				if ( src.clearUpdateRanges ) src.clearUpdateRanges();
				else src.updateRanges.length = 0;

			} else {

				writePadded( b.buffer, conv );
				// A first/full upload consumed any pending partial updates too.
				src.clearUpdateRanges?.();

			}

			b.version = version;

		}

		b.array = src.array;
		return b.buffer;

	}

	_indexBuffer( geometry ) {

		const index = geometry.index;
		if ( ! index ) return null;
		const g = this._geometryGPU( geometry );
		if ( g.indexRef && g.indexSrc === index.array && g.indexVersion === ( index.version ?? 0 ) ) return g.indexRef;
		const arr = index.array instanceof Uint16Array || index.array instanceof Uint32Array ? index.array : new Uint32Array( index.array );
		if ( ! g.index || g.index.size < arr.byteLength ) {

			if ( g.index ) g.index.buffer.destroy();
			g.index = { buffer: GPU.device.createBuffer( { label: 'index', size: Math.max( 16, align4( arr.byteLength ) ), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST } ), size: arr.byteLength };
			g.indexVersion = - 1;

		}

		if ( g.indexVersion !== ( index.version ?? 0 ) ) {

			writePadded( g.index.buffer, arr );
			g.indexVersion = index.version ?? 0;

		}

		g.indexSrc = index.array;
		g.indexRef = { buffer: g.index.buffer, format: arr instanceof Uint16Array ? 'uint16' : 'uint32' };
		return g.indexRef;

	}

	// cached _layout(): per geometry and material, checked against the attribute objects it used
	_cachedLayout( object, geometry, material ) {

		let byMat = this.layouts.get( object );
		if ( ! byMat ) this.layouts.set( object, byMat = new Map() );
		const inst = object.isInstancedMesh ? ( object.instanceColor ? 2 : 1 ) : 0;
		const mkey = inst ? material.id + ':' + inst : material.id;
		let e = byMat.get( mkey );
		if ( e && e.geometry === geometry && e.version === material.version && e.attrsVersion === geometry.attributesVersion && ( ! inst || ( e.instanceMatrix === object.instanceMatrix && e.instanceColor === object.instanceColor ) ) ) {

			const refs = e.refs, names = e.names, attrs = geometry.attributes;
			let ok = true;
			for ( let i = 0; i < names.length; i ++ ) if ( attrs[ names[ i ] ] !== refs[ i ] ) {

				ok = false;
				break;

			}

			if ( ok ) return e.vl;

		}

		const vl = this._layout( object, geometry, material );
		const names = vl.layout.filter( ( l ) => ! l.name.startsWith( 'instance' ) ).map( ( l ) => l.name );
		e = { geometry, version: material.version, attrsVersion: geometry.attributesVersion, instanceMatrix: object.instanceMatrix, instanceColor: object.instanceColor, names, refs: names.map( ( n ) => geometry.attributes[ n ] ), vl };
		vl.pipelines = new Map();
		byMat.set( mkey, e );
		return vl;

	}

	// vertex buffer layouts for this (material, geometry, object): only the attributes the shader reads
	_layout( object, geometry, material ) {

		const attrs = [];
		const want = [ 'position', 'normal', 'uv', 'color', ...Object.keys( material.attributes ) ];
		for ( const name of want ) {

			const a = geometry.attributes[ name ];
			if ( a && ! ( name === 'color' && ! material.vertexColors && ! material.attributes.color ) ) attrs.push( { name, attr: a } );

		}

		if ( object.isInstancedMesh ) {

			for ( let i = 0; i < 4; i ++ ) attrs.push( { name: 'instanceMatrix' + i, attr: object.instanceMatrix, column: i } );
			if ( object.instanceColor ) attrs.push( { name: 'instanceColor', attr: object.instanceColor } );

		}

		const buffers = [];
		const layout = [];
		const bufIndex = new Map();
		let loc = 0;
		for ( const e of attrs ) {

			const a = e.attr;
			const src = a.isInterleavedBufferAttribute ? a.data : a;
			const instanced = !! ( a.isInstancedBufferAttribute || src.isInstancedInterleavedBuffer || a.meshPerAttribute || src.meshPerAttribute ) || e.name.startsWith( 'instance' );
			const f = vertexFormat( a );
			let slot = bufIndex.get( src );
			if ( slot === undefined ) {

				slot = buffers.length;
				bufIndex.set( src, slot );
				const stride = a.isInterleavedBufferAttribute ? a.data.stride * f.bytesPerComponent : a.itemSize * f.bytesPerComponent;
				buffers.push( { src, attr: a, layout: { arrayStride: f.converted ? f.itemSize * 4 : stride, stepMode: instanced ? 'instance' : 'vertex', attributes: [] } } );

			}

			let offset = a.isInterleavedBufferAttribute ? a.offset * f.bytesPerComponent : 0;
			let format = f.format, wgsl = f.wgsl;
			if ( e.column !== undefined ) {

				offset = e.column * 16;
				format = 'float32x4';
				wgsl = 'vec4f';

			}

			buffers[ slot ].layout.attributes.push( { shaderLocation: loc, offset, format } );
			// standard attributes have fixed shader types
			if ( e.name === 'position' || e.name === 'normal' ) wgsl = 'vec3f';
			if ( e.name === 'uv' ) wgsl = 'vec2f';
			if ( e.name === 'color' ) wgsl = a.itemSize === 4 ? 'vec4f' : 'vec3f';
			if ( e.name === 'instanceColor' ) wgsl = 'vec3f';
			if ( material.attributes[ e.name ] ) wgsl = material.attributes[ e.name ];
			layout.push( { name: e.name, wgsl, location: loc, instanced } );
			loc ++;

		}

		const key = layout.map( ( l ) => `${ l.name }:${ l.wgsl }` ).join( ',' ) + '|' + buffers.map( ( b ) => `${ b.layout.arrayStride }/${ b.layout.stepMode }/${ b.layout.attributes.map( ( x ) => x.format + '@' + x.offset ).join( ';' ) }` ).join( ',' );
		return { key, layout, buffers };

	}

	// ------------------------------------------------------------------------------ pipelines

	// the pipeline of ( material, vertex layout, pass ); the material key is computed once per frame
	_pipeline( material, vl, pass ) {

		if ( material.__pkFrame !== GPU.frame ) {

			material.__pk = material.pipelineKey() + '|' + SceneLighting.version;
			material.__pkFrame = GPU.frame;

		}

		const passKey = pass.passKey;
		let c = vl.pipelines && vl.pipelines.get( passKey );
		if ( c && c.materialKey === material.__pk ) return c.p;
		const key = `${ material.__pk }|${ vl.key }|${ passKey }`;
		let p = this.pipelines.get( key );
		if ( ! p ) {

			// (local modification) a few new pipelines a frame: composing a shader costs several ms
			// on the main thread, and a new scene asks for a dozen or two at once (one long,
			// janky frame). The rest wait a frame or two — they compile asynchronously anyway.
			if ( this._budgetFrame !== GPU.frame ) { this._budgetFrame = GPU.frame; this._created = 0; }
			// (local modification) a material shaped like one already made — a new tile's ground, its
			// buildings' styles: the same program, only its own textures and uniforms — shares the
			// compiled pipeline (sharedPipelines) and costs no GPU compile: it is not held to the pace.
			// Held to it, a drone's tiles waited 10–20 s behind one another's look-alike materials.
			const shape = `${ material.constructor.name }|${ material.__pk.split( '.' ).slice( 2 ).join( '.' ) }|${ JSON.stringify( material.allDefines?.() ?? null ) }|${ [ 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap' ].map( k => material[ k ] ? 1 : 0 ).join( '' ) }|${ vl.key }|${ passKey }`;
			const known = ( this._shapes ??= new Set() ).has( shape );
			if ( known && ( this._createdKnown = this._budgetFrame === this._knownFrame ? ( this._createdKnown ?? 0 ) + 1 : 1, this._knownFrame = this._budgetFrame, this._createdKnown <= 12 ) ) { p = this._createPipeline( material, vl, pass, key ); if ( vl.pipelines ) vl.pipelines.set( passKey, { materialKey: material.__pk, p } ); return p; }
			if ( known ) return this._starve();
			this._shapes.add( shape );
			if ( this._created >= ( this.pipelinesPerFrame ?? Infinity ) ) { this._shapes.delete( shape ); return this._starve(); }
			// (local modification) and a pace in time, not only per frame: each new pipeline costs
			// the browser's GPU process ~10 ms (its one busy thread, which also draws the page), so
			// frames at a high rate still have to leave it room
			if ( this.pipelineGapMs ) {

				const now = performance.now();
				if ( now - ( this._lastCreated ?? - Infinity ) < this.pipelineGapMs ) { this._shapes.delete( shape ); return this._starve(); }
				this._lastCreated = now;

			}
			this._created ++;
			p = this._createPipeline( material, vl, pass, key );

		}
		if ( vl.pipelines ) vl.pipelines.set( passKey, { materialKey: material.__pk, p } );
		return p;

	}

	// A pipeline handle may be shared globally, but its bindings belong to one
	// material. Drop those bindings when that material leaves the view.
	forgetMaterial( material ) {

		const prefix = material.id + '.';
		for ( const key of this.pipelines.keys() ) if ( key.startsWith( prefix ) ) this.pipelines.delete( key );

	}

	_createPipeline( material, vl, pass, key ) {

		const src = buildMeshShader( material, vl.layout, pass );
		const options = { modules: src.modules, bindings: src.bindings, code: src.code, defines: src.defines, stage: 'render', label: material.name };
		if ( GPU.asyncShaders && typeof Worker !== 'undefined' ) {
			const p = { bindings: null, label: material.name };
			p.handle = GPU.deferredPipeline( composeShaderAsync( options ).then( c => {
				if ( this.disposed ) return { pipeline: null, failed: false };
				const made = this._finishPipeline( material, vl, pass, c, true, src.hasFragment );
				p.bindings = made.bindings; p.handle = made.handle; return made.handle;
			} ), material.name );
			this.pipelines.set( key, p ); this.stats.pipelines = this.pipelines.size;
			return p;
		}
		const p = this._finishPipeline( material, vl, pass, composeShader( options ), false, src.hasFragment );
		this.pipelines.set( key, p ); this.stats.pipelines = this.pipelines.size;
		return p;
	}
	_finishPipeline( material, vl, pass, c, prepared, hasFragment ) {
		const module = createShaderModule( c.code, material.name, prepared );
		this._ensureDrawBuffer();
		const layout = GPU.device.createPipelineLayout( { bindGroupLayouts: [ c.group0.layout, c.bindings.layout, this.drawLayout ] } );

		const blend = blendState( material.blending );
		let targets = [];
		if ( pass.kind === 'main' ) {

			targets = [
				{ format: pass.colorFormats[ 0 ], blend: material.transparent || pass.late ? blend : undefined, writeMask: material.colorWrite ? GPUColorWrite.ALL : 0 },
				{ format: pass.colorFormats[ 1 ], blend: pass.late ? blendState( 'premultiplied' ) : undefined, writeMask: material.colorWrite ? GPUColorWrite.ALL : 0 },
				{ format: pass.colorFormats[ 2 ], blend: blendState( 'normal' ), writeMask: material.colorWrite ? GPUColorWrite.ALL : 0 },
			];

		} else if ( pass.kind === 'color' ) {

			targets = pass.colorFormats.map( ( format ) => ( { format, blend, writeMask: material.colorWrite ? GPUColorWrite.ALL : 0 } ) );

		}

		const side = material.side;
		const cullMode = pass.cullOverride || ( side === 'double' ? 'none' : side === 'back' ? 'front' : 'back' );
		const depthCompare = material.depthTest ? ( material.depthCompare || pass.depthCompare ) : 'always';
		const desc = {
			label: material.name + ' ' + pass.kind,
			layout,
			vertex: { module, entryPoint: 'vs', buffers: vl.buffers.map( ( b ) => b.layout ) },
			primitive: { topology: material.topology, cullMode, frontFace: 'ccw' },
		};
		if ( hasFragment ) desc.fragment = { module, entryPoint: 'fs', targets };
		if ( pass.depthFormat ) desc.depthStencil = {
			format: pass.depthFormat,
			depthWriteEnabled: material.depthWrite,
			depthCompare,
			depthBias: pass.kind === 'depth' ? ( pass.depthBias || 0 ) : material.depthBias,
			depthBiasSlopeScale: pass.kind === 'depth' ? ( pass.depthBiasSlopeScale || 0 ) : material.depthBiasSlopeScale,
		};
		// compiled in the background: the draw is skipped until it is ready (see GPU.renderPipeline)
		// Reuse compiled programs across scene/complex changes. Bindings and
		// uniforms remain per material; incompatible layouts never share a handle.
		const sharedKey = ( prepared ? c.code : stripUnusedFunctions( c.code ) ) + JSON.stringify( [
			layoutId( GPU.device ), layoutId( c.group0.layout ), layoutId( c.bindings.layout ), layoutId( this.drawLayout ),
			desc.vertex.buffers, desc.primitive, desc.fragment?.targets, desc.depthStencil,
		] );
		let handle = sharedPipelines.get( sharedKey );
		if ( ! handle || handle.failed ) {
			handle = GPU.renderPipeline( desc );
			sharedPipelines.set( sharedKey, handle );
			if ( sharedPipelines.size > 128 ) sharedPipelines.delete( sharedPipelines.keys().next().value );
		}
		const p = { handle, bindings: c.bindings, label: desc.label };
		return p;

	}

	// ------------------------------------------------------------------------------ draw lists

	collect( scene, { camera, layerMask = 0xffffffff, filter = null, kind = 'main', cull = true } ) {

		let pool;
		if ( this.reuseDrawLists ) {
			if ( this._collectFrame !== GPU.frame ) { this._collectFrame = GPU.frame; this._collectIndex = 0; }
			const index = this._collectIndex ++;
			const pools = this._collectPools ??= [];
			pool = pools[ index ] ??= { opaque: [], transparent: [], items: [], count: 0 };
			pool.opaque.length = pool.transparent.length = pool.count = 0;
		}
		const opaque = pool?.opaque ?? [];
		const transparent = pool?.transparent ?? [];
		if ( camera ) {

			camera.updateMatrixWorld();
			_vp.multiplyMatrices( camera.projectionMatrix, camera.matrixWorldInverse.copy( camera.matrixWorld ).invert() );
			_frustum.setFromProjectionMatrix( _vp, camera.reversedDepth !== false );
			_camPos.setFromMatrixPosition( camera.matrixWorld );

		}

		// precompile: every mesh of the pass, hidden or not (builds all pipelines behind the loading screen)
		const all = this.precompiling;
		const visit = ( o ) => {

			if ( ! o.visible && ! all ) return;
			const emptyNative = ! all && o.worldTransformVersion !== undefined && o.isInstancedMesh && o.count === 0 && ! Object.hasOwn( o, 'onBeforeRender' );
			if ( ! emptyNative && o.isMesh && o.material && o.geometry && ( o.layers.mask & layerMask ) !== 0 && ( ! filter || filter( o ) ) && ( kind !== 'depth' || o.castShadow ) ) {

				if ( all || ! cull || ! camera || o.frustumCulled === false || this._inFrustum( o ) ) {

					// ported systems use this for their own LOD / culling (called per pass, as three does)
					if ( o.onBeforeRender ) o.onBeforeRender( null, null, camera, o.geometry, o.material, null );
					if ( o.visible || all ) this._addItems( o, opaque, transparent, pool );

				}

			}

			for ( const c of o.children ) visit( c );

		};

		// (local modification) once a frame: every pass of the frame sees the same matrices
		if ( scene.__mwFrame !== GPU.frame || this.precompiling ) { scene.updateMatrixWorld(); scene.__mwFrame = GPU.frame; }
		visit( scene );
		opaque.sort( ( a, b ) => a.renderOrder - b.renderOrder || a.pipeKey - b.pipeKey || a.z - b.z );
		transparent.sort( ( a, b ) => a.renderOrder - b.renderOrder || b.z - a.z );
		return { opaque, transparent };

	}

	_inFrustum( o ) {

		let s = null;
		if ( o.isInstancedMesh ) {

			if ( ! o.boundingSphere && o.computeBoundingSphere ) o.computeBoundingSphere();
			s = o.boundingSphere;

		} else {

			if ( ! o.geometry.boundingSphere ) o.geometry.computeBoundingSphere();
			s = o.geometry.boundingSphere;

		}

		if ( ! s || s.radius < 0 || ! Number.isFinite( s.radius ) ) return true;
		// (local modification) the world sphere once a frame, not once a pass
		let w = o.__worldSphere;
		const version = o.worldTransformVersion;
		const managed = version !== undefined;
		if ( ! w || w.src !== s || ( managed
			? w.version !== version || w.x !== s.center.x || w.y !== s.center.y || w.z !== s.center.z || w.radius !== s.radius
			: w.frame !== GPU.frame ) ) {

			w = o.__worldSphere ??= { frame: - 1, src: null, sphere: new Sphere() };
			w.sphere.copy( s ).applyMatrix4( o.matrixWorld );
			w.frame = GPU.frame; w.src = s;
			w.version = version; w.x = s.center.x; w.y = s.center.y; w.z = s.center.z; w.radius = s.radius;

		}
		return _frustum.intersectsSphere( w.sphere );

	}

	_addItems( o, opaque, transparent, pool ) {

		const geo = o.geometry;
		const mats = Array.isArray( o.material ) ? o.material : null;
		const z = _v.setFromMatrixPosition( o.matrixWorld ).distanceToSquared( _camPos );
		const push = ( material, start, count ) => {

			if ( ! material || ( ! material.visible && ! this.precompiling ) ) return;
			const item = pool ? ( pool.items[ pool.count ++ ] ??= {} ) : {};
			item.object = o; item.geometry = geo; item.material = material; item.start = start; item.count = count;
			item.z = z; item.renderOrder = o.renderOrder || 0; item.pipeKey = material.id;
			( material.transparent ? transparent : opaque ).push( item );

		};

		const range = geo.drawRange || { start: 0, count: Infinity };
		if ( mats && geo.groups && geo.groups.length ) {

			for ( const g of geo.groups ) {

				const start = Math.max( g.start, range.start );
				const end = Math.min( g.start + g.count, range.start + range.count );
				if ( end > start ) push( mats[ g.materialIndex ], start, end - start );

			}

		} else {

			push( mats ? mats[ 0 ] : o.material, range.start, range.count );

		}

	}

	// ------------------------------------------------------------------------------ render

	// Prepare a replacement while the mesh still draws its previous material.
	materialReady( object, material, passes ) {
		const vl = this._cachedLayout( object, object.geometry, material );
		let ready = true;
		for ( const descriptor of passes ) {
			const pass = { kind: 'main', late: false, colorFormats: [], depthFormat: null, depthCompare: 'greater-equal', ...descriptor };
			pass.passKey = `${ pass.kind }.${ pass.late ? 1 : 0 }.${ pass.colorFormats.join( ',' ) }.${ pass.depthFormat }.${ pass.depthCompare }.${ pass.cullOverride || '' }.${ pass.defines ? JSON.stringify( pass.defines ) : '' }`;
			const p = this._pipeline( material, vl, pass );
			if ( p?.handle.failed ) throw new Error( 'Replacement pipeline failed: ' + p.handle.label );
			if ( ! p?.handle.pipeline ) ready = false;
		}
		return ready;
	}

	render( scene, pass ) {

		this._beginFrame();
		pass = {
			kind: 'main', late: false, colorFormats: [], depthFormat: null, depthCompare: 'greater-equal',
			frameBlock: FrameUniforms, layerMask: 0xffffffff, ...pass,
		};
		pass.passKey = `${ pass.kind }.${ pass.late ? 1 : 0 }.${ pass.colorFormats.join( ',' ) }.${ pass.depthFormat }.${ pass.depthCompare }.${ pass.cullOverride || '' }.${ pass.defines ? JSON.stringify( pass.defines ) : '' }`;
		const lists = pass.items || this.collect( scene, pass );
		const enc = GPU.getEncoder();
		const colorAttachments = ( pass.colorViews || [] ).map( ( view, i ) => {

			const clear = pass.clearColors ? pass.clearColors[ i ] : null;
			return { view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: clear || [ 0, 0, 0, 0 ] };

		} );
		const desc = { label: pass.label || pass.kind, colorAttachments };
		if ( pass.depthView ) desc.depthStencilAttachment = {
			view: pass.depthView,
			depthLoadOp: pass.clearDepth === null || pass.clearDepth === undefined ? 'load' : 'clear',
			depthStoreOp: 'store',
			depthClearValue: pass.clearDepth ?? 0,
		};
		if ( pass.timestampWrites ) desc.timestampWrites = pass.timestampWrites;
		const rp = enc.beginRenderPass( desc );
		if ( pass.viewport ) rp.setViewport( ...pass.viewport );
		pass.group0 = group0ForBlock( pass.frameBlock, 'render' ).getBindGroup();
		rp.setBindGroup( 0, pass.group0 );
		this.drawItems( rp, lists.opaque, pass, 'opaque' );
		if ( pass.betweenLists ) pass.betweenLists( rp );
		this.drawItems( rp, lists.transparent, pass, 'transparent' );
		if ( pass.after ) pass.after( rp );
		rp.end();

	}

	// (local modification) a pipeline held back by the pace: `starved` tells the owner that the frame
	// left some out (a scene isn't complete while any are still to be made)
	_starve() {

		this.starved = true;
		return null;

	}

	// (local modification) Render bundles. Each draw costs the page and, more, the browser's GPU
	// process (validation, translation) every frame; a scene of a few hundred draws spent most of
	// its frame there while the GPU itself idled. Runs of draws whose every input is unchanged
	// since the last frame — pipeline, bind groups, buffers, draw range, instance count, draw
	// slot — are recorded once as a GPURenderBundle and replayed. Meshes whose instance count or
	// range keeps changing (people shown by distance) and indirect draws are drawn directly.
	// Opt in: `bundles = true`.
	drawItems( rp, items, pass, role = '' ) {

		if ( ! this.bundles || this.precompiling || ! pass.group0 ) return this._drawDirect( rp, items, pass );
		const token = ++ _listToken;
		const rows = this._drawRows ??= [];
		let rowCount = 0;
		for ( const it of items ) {

			const { object: o, geometry: geo, material } = it;
			if ( ! geo.attributes.position && ! geo.vertexCount && ! geo.indirect ) continue;
			const instances = o.isInstancedMesh ? o.count : geo.instanceCount ?? 1;
			if ( instances === 0 ) continue;
			// (local modification) the layout and buffers a draw resolves are the same in every pass of
			// a frame (scene, plants, each shadow cascade): worked out by its first pass, then reused
			let m = o.__frameRow;
			if ( ! m || m.frame !== GPU.frame || m.material !== material || m.geo !== geo || m.owner !== this ) {

				const vl = this._cachedLayout( o, geo, material );
				const reusable = m && m.material === material && m.geo === geo && m.owner === this;
				const vbs = reusable ? m.vbs : [];
				vbs.length = vl.buffers.length;
				for ( let i = 0; i < vbs.length; i ++ ) vbs[ i ] = this._attributeBuffer( geo, vl.buffers[ i ].attr );
				if ( ! reusable ) m = { material, geo, owner: this, vbs };
				m.frame = GPU.frame; m.vl = vl; m.index = this._indexBuffer( geo );
				// (an object drawn with several materials keeps only its last: the others resolve each time)
				o.__frameRow = m;

			}
			const vl = m.vl, vbs = m.vbs, index = m.index;
			const p = this._pipeline( material, vl, pass );
			if ( ! p ) continue; // over this frame's budget
			const pipeline = p.handle.pipeline || ( this.syncPipelines ? GPU.ready( p.handle ) : null );
			if ( ! pipeline ) continue; // still compiling
			const group = p.bindings.getBindGroup( token );
			const offset = this._slot( o ) * DRAW_STRIDE;
			// (changed within the last second: kept out of the bundles; compared as numbers — a
			// string a draw each frame was a good part of this loop)
			if ( o.__bsI !== instances || o.__bsS !== it.start || o.__bsC !== it.count ) { o.__bsI = instances; o.__bsS = it.start; o.__bsC = it.count; o.__bundleShapeAt = GPU.frame; }
			const steady = ! geo.indirect && GPU.frame - o.__bundleShapeAt > 60;
			const row = rows[ rowCount ] ??= {};
			row.it = it; row.o = o; row.geo = geo; row.pipeline = pipeline; row.group = group;
			row.offset = offset; row.vbs = vbs; row.instances = instances; row.index = index; row.steady = steady;
			rowCount ++;

		}

		rows.length = rowCount;
		if ( this._bundleFrame !== GPU.frame ) { this._bundleFrame = GPU.frame; ( this._bundleCalls ??= new Map() ).clear(); }
		const site = `${ pass.label || '' }|${ pass.passKey }|${ role }`;
		const nth = this._bundleCalls.get( site ) ?? 0;
		this._bundleCalls.set( site, nth + 1 );
		this._bundles ??= new Map();
		const chunked = this.bundleChunking;
		const atomic = chunked && this.bundleChunkSize === 1;
		const callKey = site + '|' + nth + ( chunked ? atomic ? '|objects' : '|chunks' : '' );
		let cache = this._bundles.get( callKey );
		if ( ! cache ) this._bundles.set( callKey, cache = chunked ? new Map() : [] );
		const state = { pipeline: null, group: null };
		let segment = [], segments = 0, replayed = false;
		const pendingBundles = [];
		const replay = () => {
			if ( ! pendingBundles.length ) return;
			rp.executeBundles( pendingBundles ); pendingBundles.length = 0;
			replayed = true; state.pipeline = null; state.group = null;
		};
		const flush = () => {

			if ( ! segment.length ) return;
			// The segment's inputs as a list of numbers (compared, not joined into a string: that
			// was most of this method's time), -1 between draws.
			const key = _sig; key.length = 0;
			if ( ! atomic ) key.push( _gpuId( pass.group0 ), _gpuId( this.drawBindGroup ) );
			if ( ! atomic ) for ( const r of segment ) {

				key.push( - 1, _gpuId( r.pipeline ), _gpuId( r.group ), r.offset, r.instances, r.it.start, r.it.count, r.vbs.length );
				for ( const b of r.vbs ) key.push( _gpuId( b ) );
				if ( r.index ) key.push( _gpuId( r.index.buffer ), r.index.format === 'uint32' ? 2 : 1, r.geo.index ? r.geo.index.count : - 2 );
				else key.push( 0, 0, r.geo.attributes.position ? r.geo.attributes.position.count : r.geo.vertexCount );

			}

			// Stable draw-slot boundaries keep a camera cull from invalidating a
			// several-hundred-draw bundle. Draw order, buffers and ranges are identical.
			const last = segment[ segment.length - 1 ];
			const chunkKey = atomic ? last.o : chunked ? `${ last.offset }/${ _gpuId( last.group ) }/${ last.it.start }` : segments;
			let c = chunked ? cache.get( chunkKey ) : cache[ segments ];
			let same;
			if ( atomic ) {
				// Compare GPU references directly for the single-object bundle. A
				// numeric signature otherwise repeated WeakMap lookups for every
				// buffer in every pass, despite those references being unchanged.
				const r = last;
				const total = r.index ? r.geo.index.count : r.geo.attributes.position?.count ?? r.geo.vertexCount;
				same = !! c && c.group0 === pass.group0 && c.drawGroup === this.drawBindGroup && c.pipeline === r.pipeline && c.group === r.group && c.offset === r.offset && c.instances === r.instances && c.start === r.it.start && c.count === r.it.count && c.total === total && c.indexBuffer === ( r.index?.buffer ?? null ) && c.indexFormat === r.index?.format && c.vbs.length === r.vbs.length;
				if ( same ) for ( let i = 0; i < r.vbs.length; i ++ ) if ( c.vbs[ i ] !== r.vbs[ i ] ) { same = false; break; }
			} else {
				same = !! c && c.key.length === key.length;
				if ( same ) for ( let i = 0; i < key.length; i ++ ) if ( c.key[ i ] !== key[ i ] ) { same = false; break; }
			}
			if ( ! same ) {

				const be = GPU.device.createRenderBundleEncoder( {
					label: ( pass.label || pass.kind ) + ' bundle',
					colorFormats: pass.colorFormats, depthStencilFormat: pass.depthFormat || undefined, sampleCount: pass.sampleCount || 1,
				} );
				be.setBindGroup( 0, pass.group0 );
				const own = { pipeline: null, group: null };
				for ( const r of segment ) this._drawRow( be, r, own );
				c = { key: key.slice(), bundle: be.finish(), at: GPU.frame };
				if ( atomic ) {
					const r = last;
					Object.assign( c, { group0: pass.group0, drawGroup: this.drawBindGroup, pipeline: r.pipeline, group: r.group, offset: r.offset, instances: r.instances, start: r.it.start, count: r.it.count, total: r.index ? r.geo.index.count : r.geo.attributes.position?.count ?? r.geo.vertexCount, indexBuffer: r.index?.buffer ?? null, indexFormat: r.index?.format, vbs: r.vbs.slice() } );
				}
				if ( chunked ) cache.set( chunkKey, c ); else cache[ segments ] = c;
				this.stats.bundleBuilds ++;
				this.stats.bundleEncodedDraws += segment.length;

			} else {

				// (the counts the direct path keeps, for the overlay)
				for ( const r of segment ) {
					const total = r.index ? r.geo.index.count : r.geo.attributes.position?.count ?? r.geo.vertexCount;
					this.stats.draws ++;
					this.stats.triangles += Math.max( 0, Math.min( r.it.count, total - r.it.start ) ) / 3 * r.instances;
				}

			}

			c.at = GPU.frame;
			pendingBundles.push( c.bundle );
			segments ++;
			segment.length = 0;

		};

		for ( const r of rows ) {

			if ( r.steady ) {
				segment.push( r );
				if ( atomic || ( chunked && ( ( ( r.offset / DRAW_STRIDE ) & 31 ) === 0 || segment.length >= 64 ) ) ) flush();
				continue;
			}
			flush();
			replay();
			if ( replayed ) { rp.setBindGroup( 0, pass.group0 ); replayed = false; }
			this._drawRow( rp, r, state );

		}

		flush();
		replay();
		if ( chunked ) {
			if ( GPU.frame % 120 === 0 || cache.size > 1024 ) for ( const [ key, c ] of cache ) if ( GPU.frame - c.at > 240 ) cache.delete( key );
		} else cache.length = segments;
		if ( replayed ) rp.setBindGroup( 0, pass.group0 );

	}

	// one draw (the direct path's body): pipeline and material group when they change, the draw's
	// slot, its buffers, the draw call
	_drawRow( enc, r, state ) {

		const { it, geo } = r;
		if ( r.pipeline !== state.pipeline ) { enc.setPipeline( r.pipeline ); state.pipeline = r.pipeline; }
		if ( r.group !== state.group ) { enc.setBindGroup( 1, r.group ); state.group = r.group; }
		enc.setBindGroup( 2, this.drawBindGroup, [ r.offset ] );
		for ( let i = 0; i < r.vbs.length; i ++ ) enc.setVertexBuffer( i, r.vbs[ i ] );
		const instances = r.instances, index = r.index;
		if ( geo.indirect ) {

			const ib = geo.indirect.buffer.getGPU ? geo.indirect.buffer.getGPU() : geo.indirect.buffer;
			const offs = geo.indirect.offsets || [ geo.indirect.offset || 0 ];
			if ( index ) enc.setIndexBuffer( index.buffer, index.format );
			for ( const off of offs ) {

				if ( index ) enc.drawIndexedIndirect( ib, off );
				else enc.drawIndirect( ib, off );
				this.stats.draws ++;

			}

			return;

		}

		if ( index ) {

			const count = Math.min( it.count, geo.index.count - it.start );
			if ( count <= 0 ) return;
			enc.setIndexBuffer( index.buffer, index.format );
			enc.drawIndexed( count, instances === Infinity ? 1 : instances, it.start, 0, 0 );
			this.stats.triangles += count / 3 * instances;

		} else {

			const total = geo.attributes.position ? geo.attributes.position.count : geo.vertexCount;
			const count = Math.min( it.count, total - it.start );
			if ( count <= 0 ) return;
			enc.draw( count, instances, it.start, 0 );
			this.stats.triangles += count / 3 * instances;

		}

		this.stats.draws ++;

	}

	_drawDirect( rp, items, pass ) {

		let lastPipeline = null, lastGroup = null;
		const token = ++ _listToken;
		for ( const it of items ) {

			const { object: o, geometry: geo, material } = it;
			if ( ! geo.attributes.position && ! geo.vertexCount && ! geo.indirect ) continue;
			let vl, p;
			if ( this.precompiling ) {

				// a hidden mesh may not be drawable yet: its pipeline is optional
				try {

					vl = this._cachedLayout( o, geo, material );
					p = this._pipeline( material, vl, pass );
					if ( ! p ) continue;

				} catch ( e ) {

					continue;

				}

				continue; // only the pipelines are wanted

			}

			vl = this._cachedLayout( o, geo, material );
			p = this._pipeline( material, vl, pass );
			if ( ! p ) continue; // over this frame's budget
			const pipeline = p.handle.pipeline || ( this.syncPipelines ? GPU.ready( p.handle ) : null );
			if ( ! pipeline ) continue; // still compiling
			if ( p !== lastPipeline ) {

				rp.setPipeline( pipeline );
				lastPipeline = p;

			}

			const group = p.bindings.getBindGroup( token );
			if ( group !== lastGroup ) {

				rp.setBindGroup( 1, group );
				lastGroup = group;

			}

			rp.setBindGroup( 2, this.drawBindGroup, [ this._slot( o ) * DRAW_STRIDE ] );
			for ( let i = 0; i < vl.buffers.length; i ++ ) rp.setVertexBuffer( i, this._attributeBuffer( geo, vl.buffers[ i ].attr ) );
			const instances = o.isInstancedMesh ? o.count : geo.instanceCount ?? 1;
			if ( instances === 0 ) continue;
			const index = this._indexBuffer( geo );
			if ( geo.indirect ) {

				const ib = geo.indirect.buffer.getGPU ? geo.indirect.buffer.getGPU() : geo.indirect.buffer;
				// `offsets`: several indirect commands (byte offsets) in one buffer, drawn in turn
				// (three's geometry.setIndirect( attr, offsets ) multi-draw)
				const offs = geo.indirect.offsets || [ geo.indirect.offset || 0 ];
				if ( index ) rp.setIndexBuffer( index.buffer, index.format );
				for ( const off of offs ) {

					if ( index ) rp.drawIndexedIndirect( ib, off );
					else rp.drawIndirect( ib, off );
					this.stats.draws ++;

				}

				continue;

			}

			if ( index ) {

				const count = Math.min( it.count, geo.index.count - it.start );
				if ( count <= 0 ) continue;
				rp.setIndexBuffer( index.buffer, index.format );
				rp.drawIndexed( count, instances === Infinity ? 1 : instances, it.start, 0, 0 );
				this.stats.triangles += count / 3 * instances;

			} else {

				const total = geo.attributes.position ? geo.attributes.position.count : geo.vertexCount;
				const count = Math.min( it.count, total - it.start );
				if ( count <= 0 ) continue;
				rp.draw( count, instances, it.start, 0 );
				this.stats.triangles += count / 3 * instances;

			}

			this.stats.draws ++;

		}

	}

}

// ---------------------------------------------------------------------------------- formats

function align4( n ) {

	return Math.ceil( n / 4 ) * 4;

}

function writePadded( buffer, arr ) {

	if ( arr.byteLength % 4 === 0 ) {

		GPU.queue.writeBuffer( buffer, 0, arr.buffer, arr.byteOffset, arr.byteLength );
		return;

	}

	const padded = new Uint8Array( align4( arr.byteLength ) );
	padded.set( new Uint8Array( arr.buffer, arr.byteOffset, arr.byteLength ) );
	GPU.queue.writeBuffer( buffer, 0, padded );

}

const _convCache = new WeakMap();

// the attribute's array as uploaded (8/16-bit arrays with itemSize 1 or 3 are widened to float32)
function convertArray( attr ) {

	const src = attr.isInterleavedBufferAttribute ? attr.data : attr;
	const f = vertexFormat( attr );
	if ( ! f.converted ) return src.array;
	let c = _convCache.get( src );
	if ( c && c.version === src.version ) return c.array;
	const n = attr.count, k = attr.itemSize;
	const out = new Float32Array( n * k );
	const div = attr.normalized ? normDiv( src.array ) : 1;
	for ( let i = 0; i < n * k; i ++ ) out[ i ] = src.array[ i ] / div;
	_convCache.set( src, { version: src.version, array: out } );
	return out;

}

function normDiv( a ) {

	if ( a instanceof Uint8Array ) return 255;
	if ( a instanceof Int8Array ) return 127;
	if ( a instanceof Uint16Array ) return 65535;
	if ( a instanceof Int16Array ) return 32767;
	return 1;

}

function vertexFormat( attr ) {

	const src = attr.isInterleavedBufferAttribute ? attr.data : attr;
	const a = src.array;
	const k = attr.itemSize;
	const n = attr.normalized;
	const vec = ( base ) => k === 1 ? base : `vec${ k }${ base === 'f32' ? 'f' : base === 'u32' ? 'u' : 'i' }`;
	if ( a instanceof Float32Array ) return { format: k === 1 ? 'float32' : `float32x${ k }`, wgsl: vec( 'f32' ), bytesPerComponent: 4, itemSize: k };
	if ( a instanceof Uint32Array ) return { format: k === 1 ? 'uint32' : `uint32x${ k }`, wgsl: vec( 'u32' ), bytesPerComponent: 4, itemSize: k };
	if ( a instanceof Int32Array ) return { format: k === 1 ? 'sint32' : `sint32x${ k }`, wgsl: vec( 'i32' ), bytesPerComponent: 4, itemSize: k };
	const small = { Uint8Array: [ 'uint8', 'unorm8', 1 ], Int8Array: [ 'sint8', 'snorm8', 1 ], Uint16Array: [ 'uint16', 'unorm16', 2 ], Int16Array: [ 'sint16', 'snorm16', 2 ] }[ a.constructor.name ];
	if ( small && ( k === 2 || k === 4 ) && ! attr.isInterleavedBufferAttribute ) {

		const fmt = ( n ? small[ 1 ] : small[ 0 ] ) + 'x' + k;
		const wgsl = n ? vec( 'f32' ) : vec( a instanceof Uint8Array || a instanceof Uint16Array ? 'u32' : 'i32' );
		return { format: fmt, wgsl, bytesPerComponent: small[ 2 ], itemSize: k };

	}

	return { format: k === 1 ? 'float32' : `float32x${ k }`, wgsl: vec( 'f32' ), bytesPerComponent: 4, itemSize: k, converted: true };

}
