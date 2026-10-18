/** Only position contributes to an opaque, undeformed triangle's shadow. */
export function opaqueDepthEligible( material, pass ) {
	return pass.kind === 'depth' && ! material.vertex.trim() && material.alphaTest <= 0 &&
		! material.shadow && ! material.defines?.REFRACTION_CLIP && ! pass.defines?.REFRACTION_CLIP && material.topology === 'triangle-list';
}

/** Exact position welding for shadow-only drawing. Triangle order, winding and draw
 * ranges stay intact. Flat-shaded leaves repeat each corner for three face normals;
 * the depth pass can transform that corner once. No quantisation or simplification.
 * Opt in only for the small, shared tree models, never streamed city geometry. */
export function compactDepthPositions( geometry ) {
	const p = geometry.attributes.position, source = p.array, index = geometry.index;
	if ( ! index || p.isInterleavedBufferAttribute || !( source instanceof Float32Array ) || p.itemSize !== 3 ) return null;
	const unique = [], ids = new Map(), remap = new Uint32Array( p.count );
	for ( let i = 0; i < p.count; i ++ ) {
		const at = i * 3, x = source[ at ], y = source[ at + 1 ], z = source[ at + 2 ];
		const key = `${ x },${ y },${ z }`;
		let id = ids.get( key );
		if ( id === undefined ) { id = unique.length / 3; ids.set( key, id ); unique.push( x, y, z ); }
		remap[ i ] = id;
	}
	const array = new Float32Array( unique );
	const indices = unique.length / 3 <= 65536 ? new Uint16Array( index.count ) : new Uint32Array( index.count );
	for ( let i = 0; i < index.count; i ++ ) indices[ i ] = remap[ index.array[ i ] ];
	return {
		position: { array, itemSize: 3, count: array.length / 3, version: 0 },
		indices,
	};
}
