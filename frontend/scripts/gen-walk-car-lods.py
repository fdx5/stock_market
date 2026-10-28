"""Derive distance meshes from the original close-range cars. No app data access."""
import ast,json,math,struct
from pathlib import Path
import bpy,bmesh

HERE=Path(__file__).resolve().parent;OUT=HERE.parent/'public/3d/walk/cars'
base=HERE/'gen-cars.py';tree=ast.parse(base.read_text(encoding='utf-8'));nodes=[]
for node in tree.body:
    if isinstance(node,ast.For) and isinstance(node.target,ast.Tuple) and [getattr(n,'id',None) for n in node.target.elts]==['kind','sp']:break
    nodes.append(node)
env={'__file__':str(base),'__name__':'walk_car_lod_helpers'}
exec(compile(ast.Module(body=nodes,type_ignores=[]),str(base),'exec'),env)
env['PARTS']+=['glass_front','glass_rear','brake','interior'];env['SWATCH']={name:((i+.5)/16,.5) for i,name in enumerate(env['PARTS'])}
metadata=json.loads((OUT/'cars.json').read_text())['kinds'];raw=(OUT/'cars.bin').read_bytes();blob=bytearray();output={'kinds':{}}
def put(data):
    while len(blob)%4:blob.append(0)
    offset=len(blob);blob.extend(data);return offset
for name,p in metadata.items():
    env['clear']();n=p['verts'];positions=struct.unpack_from(f'<{n*3}f',raw,p['pos']);uv=struct.unpack_from(f'<{n*2}H',raw,p['uv']);indices=struct.unpack_from(f'<{p["index"]}H',raw,p['idx'])
    mesh=bpy.data.meshes.new(name);mesh.from_pydata([(-positions[i],positions[i+2],positions[i+1]) for i in range(0,n*3,3)],[],[indices[i:i+3] for i in range(0,len(indices),3)])
    for part in env['PARTS']:mesh.materials.append(env['mat'](part))
    for i,poly in enumerate(mesh.polygons):poly.material_index=min(15,int(uv[indices[i*3]*2]/65535*16));poly.use_smooth=True
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00015);bm.to_mesh(mesh);bm.free()
    obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj);lods=[]
    for ratio in [.20,.055]:
        reduced=obj.copy();reduced.data=mesh.copy();bpy.context.scene.collection.objects.link(reduced)
        bpy.context.view_layer.objects.active=reduced;reduced.select_set(True)
        modifier=reduced.modifiers.new('distance_mesh','DECIMATE');modifier.ratio=ratio;modifier.delimit={'MATERIAL'};modifier.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        pos,nor,tex,idx=env['export'](reduced);count=len(pos)//3
        packed=b''.join(struct.pack('<4b',*(max(-127,min(127,round(c*127))) for c in nor[i*3:i*3+3]),0) for i in range(count))
        lods.append({'verts':count,'index':len(idx),'pos':put(struct.pack(f'<{len(pos)}f',*pos)),'nor':put(packed),'uv':put(struct.pack(f'<{len(tex)}H',*(round(c*65535) for c in tex))),'idx':put(struct.pack(f'<{len(idx)}H',*idx))})
    output['kinds'][name]=lods;print(name,[p['index']//3 for p in lods],flush=True)
(OUT/'lods.bin').write_bytes(blob);(OUT/'lods.json').write_text(json.dumps(output,separators=(',',':')),encoding='utf-8')
print('Distance meshes:',len(blob),'bytes',flush=True)
