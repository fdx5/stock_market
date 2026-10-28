"""Append hollow, window-cut truck/bus cabins to walk-only assets. Run in Blender.
Original drive assets and stored application data are never opened for writing.
"""
import ast,json,struct
from pathlib import Path
import bpy
from mathutils import Vector

HERE=Path(__file__).resolve().parent;BASE=HERE/'gen-cars.py';OUT=HERE.parent/'public/3d/walk/cars'
nodes=[]
for node in ast.parse(BASE.read_text(encoding='utf-8')).body:
    if isinstance(node,ast.For) and isinstance(node.target,ast.Tuple) and [getattr(n,'id',None) for n in node.target.elts]==['kind','sp']:break
    nodes.append(node)
env={'__file__':str(BASE),'__name__':'walk_truck_helpers'};exec(compile(ast.Module(body=nodes,type_ignores=[]),str(BASE),'exec'),env)
env['PARTS']+=['glass_front','glass_rear','brake','interior'];env['SWATCH']={name:((i+.5)/16,.5) for i,name in enumerate(env['PARTS'])}
old_box,old_rbox=env['box'],env['rbox'];shells=[];current=''

def cut(shell,size,location):
    cutter=old_box('walk_window_cut','trim',size,location)
    bpy.context.view_layer.objects.active=shell
    mod=shell.modifiers.new('real_cabin_opening','BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter,do_unlink=True)

def make(name,material,size,location,bevel=0,seg=3):
    global shells
    if material=='glass':
        # Remove the actual metal behind the window, retaining its surrounding
        # roof/pillars. One optical surface avoids overlapping glass-box faces.
        dims=list(size);axis=0 if size[0]<size[1] else 1;dims[axis]=.7
        for shell in shells:cut(shell,dims,location)
        x,y,z=location;w,d,h=size
        if axis==1:
            sign=1 if y>=0 else -1;vertices=[(-w/2,y,z-h/2),(w/2,y,z-h/2),(w/2,y,z+h/2),(-w/2,y,z+h/2)]
            if sign>0:vertices.reverse()
            part='glass_front' if name=='wind' else 'glass_rear'
        else:
            vertices=[(x,y-d/2,z-h/2),(x,y+d/2,z-h/2),(x,y+d/2,z+h/2),(x,y-d/2,z+h/2)]
            if x<0:vertices.reverse()
            part='glass'
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],[(0,1,2,3)]);mesh.materials.append(env['mat'](part));obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj);return obj
    obj=old_rbox(name,material,size,location,bevel,seg) if bevel else old_box(name,material,size,location)
    if name=='cab' or (current=='bus' and name=='body'):
        shells.append(obj);inner=tuple(max(.05,v-.14) for v in size);cut(obj,inner,location)
    return obj

env['box']=lambda name,material,size,location,bevel=0:make(name,material,size,location,bevel,2)
env['rbox']=make
# old_rbox calls _rbox directly for bevelled pieces, so make never recurses.
metadata=json.loads((OUT/'cars.json').read_text(encoding='utf-8'));blob=bytearray((OUT/'cars.bin').read_bytes())
def put(data):
    while len(blob)%4:blob.append(0)
    start=len(blob);blob.extend(data);return start
for kind in env['TRUCKS']:
    current=kind;shells=[];car=env['truck'](kind);pos,nor,uv,idx=env['export'](car);n=len(pos)//3
    if n>=65536:raise RuntimeError((kind,n))
    xs=pos[0::3];ys=pos[1::3];zs=pos[2::3]
    packed=b''.join(struct.pack('<4b',*(max(-127,min(127,round(v*127))) for v in nor[i*3:i*3+3]),0) for i in range(n))
    metadata['kinds'][kind]={'label':kind,'frontDesign':6+env['TRUCKS'].index(kind),'rearDesign':6+env['TRUCKS'].index(kind),'length':max(zs)-min(zs),'width':max(xs)-min(xs),'height':max(ys)-min(ys),'cabin':'hollow-window-cut-v1','verts':n,'index':len(idx),'pos':put(struct.pack(f'<{len(pos)}f',*pos)),'nor':put(packed),'uv':put(struct.pack(f'<{len(uv)}H',*(round(v*65535) for v in uv))),'idx':put(struct.pack(f'<{len(idx)}H',*idx))}
    print(kind,n,len(idx)//3,flush=True)
(OUT/'cars.bin').write_bytes(blob);(OUT/'cars.json').write_text(json.dumps(metadata,separators=(',',':')),encoding='utf-8')
print('Hollow truck and bus cabins ready',flush=True)
