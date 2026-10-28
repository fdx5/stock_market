"""Close-range /walk cars. Run in a fresh Blender --factory-startup process.

Reuses the repository's original vehicle proportions/building helpers without
running its exporter. Outputs ONLY public/3d/walk/cars; drive/drone assets stay intact.
"""
import ast
import json
import math
import struct
import copy
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
BASE = HERE / 'gen-cars.py'
tree = ast.parse(BASE.read_text(encoding='utf-8'))
definitions = []
for node in tree.body:
    if isinstance(node, ast.For) and isinstance(node.target, ast.Tuple):
        if [getattr(n, 'id', None) for n in node.target.elts] == ['kind', 'sp']:
            break
    # More longitudinal sections, keeping the original measured proportions.
    if isinstance(node, ast.FunctionDef) and node.name == 'body_shell':
        for child in ast.walk(node):
            if isinstance(child, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'S' for t in child.targets):
                child.value = ast.Constant(value=40)
            if isinstance(child, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'b_t' for t in child.targets):
                child.value=ast.parse("c0 + (c1-c0) * (0.72 if sp.get('_doors') == 2 else (0.52 if L > 4.2 else 0.6))",mode='eval').body
    definitions.append(node)
namespace = {'__file__': str(BASE), '__name__': 'walk_car_helpers'}
exec(compile(ast.fix_missing_locations(ast.Module(body=definitions, type_ignores=[])), str(BASE), 'exec'), namespace)
namespace['PARTS'] += ['glass_front', 'glass_rear', 'brake', 'interior']
namespace['SWATCH'] = {name: ((i + .5) / 16, .5) for i, name in enumerate(namespace['PARTS'])}
body_shell, box, lathe, mat = [namespace[n] for n in ['body_shell', 'box', 'lathe', 'mat']]
OUT = HERE.parent / 'public/3d/walk/cars'
OUT.mkdir(parents=True, exist_ok=True)

# Twenty-two additional shapes, not colour aliases. Length/width/height, roof
# profile and overhangs change together; each receives its own lamp package.
VARIANTS = [
 ('micro-ev','초소형 전기 해치백','hatchback-sports',.87,.96,1.02,0),
 ('city-hatch','도심형 해치백','hatchback-sports',1.04,1.01,1.02,1),
 ('sport-coupe','스포츠 쿠페','sedan-sports',.97,1.04,.91,2),
 ('luxury-coupe','대형 럭셔리 쿠페','sedan-large',1.01,1.04,.93,3),
 ('electric-fastback','전기 패스트백','sedan',1.04,1.04,1.04,4),
 ('sport-fastback','스포츠 패스트백','sedan-sports',1.05,1.02,.96,5),
 ('family-wagon','패밀리 왜건','sedan',1.04,1.01,1.04,0),
 ('sport-wagon','스포츠 왜건','sedan-sports',1.03,1.03,1.02,2),
 ('compact-sedan','소형 세단','sedan',.91,.97,1.01,1),
 ('executive-lwb','롱휠베이스 세단','sedan-large',1.10,1.03,1.03,5),
 ('electric-sedan','전기 세단','sedan',1.02,1.02,1.05,3),
 ('crossover-coupe','쿠페형 크로스오버','suv-small',1.06,1.03,.94,4),
 ('compact-crossover','소형 크로스오버','suv-small',.94,.98,.98,0),
 ('electric-crossover','전기 크로스오버','suv-small',1.02,1.04,1.04,1),
 ('electric-suv','전기 SUV','suv',1.05,1.04,1.03,4),
 ('premium-suv','프리미엄 SUV','suv-luxury',1.02,1.04,1.03,5),
 ('offroad-suv','박스형 오프로더','suv-luxury',.94,1.01,1.10,2),
 ('seven-seat-suv','7인승 SUV','suv-luxury',1.07,1.01,1.02,3),
 ('family-mpv','패밀리 MPV','mpv',.98,1.01,1.05,0),
 ('executive-mpv','고급 MPV','mpv',1.04,1.04,1.06,5),
 ('compact-van','소형 밴','van',.84,.95,.98,1),
 ('passenger-van-lwb','롱바디 승합 밴','van',1.12,1.01,1.01,4),
]
for name,label,base,sx,sy,sz,style in VARIANTS:
    sp=copy.deepcopy(namespace['SPECS'][base]);sp['length']*=sx;sp['width']*=sy;sp['height']*=sz
    sp['top']=[[t,h*sz] for t,h in sp['top']];sp['belt']*=sz;sp['clearance']*=min(sz,1.05);sp['wheel']*=min(1.07,max(.94,sy))
    if 'wagon' in name:
        sp['top']=[[0,.78*sz],[.025,1.1*sz],[.09,1.42*sz],[.2,1.48*sz],[.58,1.48*sz],[.68,1.36*sz],[.76,1.03*sz],[.94,.91*sz],[1,.65*sz]]
        sp['cabin']=[.10,.74]
    elif 'coupe' in name or 'fastback' in name:
        sp['roof']*=.94;sp['cabin'][0]=max(.17,sp['cabin'][0]-.04)
        if 'crossover' not in name:sp['axles']=[.18,.81]
    elif name=='offroad-suv':
        sp['roof']=.89;sp['tumble']=.08;sp['clearance']+=.045
        sp['top']=[[0,1.03],[.025,1.5],[.08,sp['height']],[.57,sp['height']],[.68,sp['height']*.96],[.75,1.27],[.96,1.22],[1,.88]]
    sp['_label']=label;sp['_front']=style;sp['_rear']=(style+len(name))%6
    sp['_doors']=2 if name in ['sport-coupe','luxury-coupe'] else 4
    namespace['SPECS'][name]=sp
for i,(name,sp) in enumerate(namespace['SPECS'].items()):
    sp.setdefault('_front',i%6);sp.setdefault('_rear',(i*5+2)%6);sp.setdefault('_label',name)


def tube(name, part, points, radius=.004, resolution=2):
    curve = bpy.data.curves.new(name, 'CURVE'); curve.dimensions = '3D'
    curve.resolution_u = 1; curve.bevel_depth = radius; curve.bevel_resolution = resolution
    spline = curve.splines.new('POLY'); spline.points.add(len(points)-1)
    for point, co in zip(spline.points, points): point.co = (*co, 1)
    obj = bpy.data.objects.new(name, curve); bpy.context.scene.collection.objects.link(obj)
    obj.data.materials.append(mat(part))
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target='MESH'); return bpy.context.active_object


def cylinder(name, part, radius, depth, location, axis='X', vertices=40):
    rotation = (0, math.pi/2, 0) if axis == 'X' else (math.pi/2, 0, 0)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation)
    obj = bpy.context.active_object; obj.name = name; obj.data.materials.append(mat(part))
    for p in obj.data.polygons: p.use_smooth = len(p.vertices) == 4
    return obj


def wheel(sp, x, y, side):
    r, w = sp['wheel'], .225
    tyre = lathe('radial_tyre', 'tyre', [(r*.68,-w*.5),(r*.88,-w*.54),(r*.97,-w*.40),(r,-w*.24),(r,w*.24),(r*.97,w*.40),(r*.88,w*.54),(r*.68,w*.5)], 64, (x,y,r), side)
    parts = [tyre]
    front = x + side * (w*.5-.014)
    parts.append(lathe('alloy_barrel', 'rim', [(r*.65,-.06),(r*.7,-.05),(r*.71,.008),(r*.68,.017),(r*.65,.01),(r*.64,-.04)],64,(front,y,r),side))
    parts.append(cylinder('ventilated_brake_disc','brake',r*.57,.014,(front-side*.045,y,r)))
    parts.append(box('brake_caliper','trim',(.045,r*.25,r*.38),(front-side*.028,y+r*.42,r),.014))
    parts.append(cylinder('alloy_hub','rim',r*.18,.055,(front-side*.013,y,r)))
    # Four wheel designs: split five, six, split seven and ten-spoke alloy rims.
    design=sp['_front']%4;count=[5,6,7,10][design]
    for k in range(count):
        angle=k/count*math.tau
        inner=Vector((front,y+math.cos(angle)*r*.14,r+math.sin(angle)*r*.14))
        middle=Vector((front+side*.008,y+math.cos(angle)*r*.4,r+math.sin(angle)*r*.4))
        for delta in ([-.075,.075] if design in [0,2] else [0]):
            end=Vector((front-side*.008,y+math.cos(angle+delta)*r*.66,r+math.sin(angle+delta)*r*.66))
            parts.append(tube('split_spoke','rim',[inner,middle,end],.012,1))
    for k in range(5):
        a=k/5*math.tau
        parts.append(cylinder('lug_bolt','chrome',.011,.013,(front+side*.02,y+math.cos(a)*r*.105,r+math.sin(a)*r*.105),vertices=8))
    for offset in [-.067,-.022,.022,.067]:
        points=[(x+offset,y+math.cos(k/64*math.tau)*r*1.001,r+math.sin(k/64*math.tau)*r*1.001) for k in range(65)]
        parts.append(tube('circumferential_tread','trim',points,.0028,0))
    return parts


def details(sp, body):
    length, half = sp['length'], sp['width']/2
    parts=[]
    def side_point(t,z,side):
        hit, p, normal, _ = body.ray_cast(Vector((side*(half+1),(t-.5)*length,z)),Vector((-side,0,0)))
        return p + normal*.007 if hit else None
    def top_point(x,t):
        hit,p,normal,_=body.ray_cast(Vector((x,(t-.5)*length,sp['height']+1)),Vector((0,0,-1)))
        return p+normal*.008 if hit else None
    # Front/rear doors: continuous fitted panel gaps, lower shut lines, handle recesses.
    rear=max(sp['cabin'][0]+.025,.24); front=sp['cabin'][1]-.025; middle=(rear+front)*.5
    for side in [-1,1]:
        low=sp['clearance']+.16; high=sp['belt']-.025
        for a,b in ([(rear,front)] if sp.get('_doors')==2 else [(rear,middle),(middle,front)]):
            points=[]
            for t,z in [(a,high),(a,low+.12),(a+.012,low),(b-.012,low),(b,low+.12),(b,high)]:
                p=side_point(t,z,side)
                if p is not None: points.append(p)
            if len(points)>2: parts.append(tube('door_panel_gap','trim',points,.0032,1))
            p=side_point(a+(b-a)*.24,sp['belt']-.10,side)
            if p is not None:
                parts.append(box('handle_recess','trim',(.014,.165,.044),p,.012))
                p.x+=side*.013;parts.append(box('door_handle','chrome',(.024,.128,.025),p,.009))
        # Mirrors have a stalk, painted housing and a separate reflective mirror face.
        y=(front-.5)*length-.025; z=sp['belt']+.16
        parts.append(tube('mirror_stalk','trim',[(side*(half-.04),y,z-.09),(side*(half+.12),y,z)],.018,1))
        parts.append(box('mirror_housing','body',(.21,.245,.145),(side*(half+.15),y,z),.035))
        parts.append(box('mirror_glass','chrome',(.16,.008,.103),(side*(half+.15),y-.123,z),.018))
    # Rubber window seals exactly follow the shell's glass/body boundaries.
    mesh=body.data; adjacent={}
    for poly in mesh.polygons:
        for edge in poly.edge_keys: adjacent.setdefault(tuple(sorted(edge)),[]).append(poly.material_index)
    glass_ids={1,12,13}
    for (a,b),mats in adjacent.items():
        if any(m in glass_ids for m in mats) and any(m not in glass_ids for m in mats):
            va,vb=mesh.vertices[a],mesh.vertices[b]
            parts.append(tube('window_weather_seal','trim',[va.co+va.normal*.007,vb.co+vb.normal*.007],.006,1))
    # Two wiper arms/blades on the front windscreen.
    for x in [-half*.36,half*.23]:
        a=top_point(x,sp['cabin'][1]-.005);b=top_point(x+.12,sp['cabin'][1]-.065);c=top_point(x+.28,sp['cabin'][1]-.10)
        if all(p is not None for p in [a,b,c]): parts.append(tube('windscreen_wiper','trim',[a,b,c],.005,1))
    # Six genuinely different front/rear optical layouts. All curves are projected
    # onto this particular shell, rather than identical lamp bars on every type.
    for sign,part,key in [(1,'lamp','_front'),(-1,'tail','_rear')]:
        z0=min(sp['belt']-.13,namespace['curve'](sp['top'],.97 if sign>0 else .03)-.14)
        def surface(x,z):
            hit,p,n,_=body.ray_cast(Vector((x,sign*(length*.5+1),z)),Vector((0,-sign,0)))
            return p+n*.012 if hit else None
        def strip(points,radius=.012):
            projected=[surface(x,z) for x,z in points];projected=[p for p in projected if p is not None]
            if len(projected)>1:
                parts.append(tube('optical_housing','trim',projected,radius*1.8,1))
                parts.append(tube('led_signature',part,[p+Vector((0,sign*(radius*1.55+.003),0)) for p in projected],radius,1))
        style=sp[key]
        if sign<0 and style==0:strip([(-half*.82,z0),(-half*.4,z0),(0,z0),(half*.4,z0),(half*.82,z0)],.014)
        for side in [-1,1]:
            def path(points,r=.012):strip([(side*half*x,z0+z) for x,z in points],r)
            if (sign>0 and style==0) or (sign<0 and style==1):
                for dz in [-.035,.035]:path([(.40,dz),(.58,dz),(.78,dz)],.011)
            elif style==1 or (sign<0 and style==2):
                for row in range(2 if sign>0 else 4):
                    for col in range(4 if sign>0 else 2):
                        p=surface(side*half*(.43+col*.105),z0+(row-.5)*.045)
                        if p is not None:parts.append(box('matrix_led',part,(.055,.018,.024),p,.005))
            elif style==2 or (sign<0 and style==3):
                for x in [.48,.72]:
                    p=surface(side*half*x,z0)
                    if p is not None:
                        parts.append(cylinder('projector_surround','trim',.065,.018,p,axis='Y'))
                        p.y+=sign*.014;parts.append(cylinder('projector_optic',part,.049,.009,p,axis='Y'))
                path([(.37,.073),(.58,.09),(.81,.07)],.008)
            elif style==3 or (sign<0 and style==4):
                path([(.36,.055),(.65,.055),(.82,.025),(.82,-.075)],.013)
                path([(.42,-.045),(.64,-.045)],.014)
            elif style==4:
                path([(.38,.09),(.6,.09),(.82,.09)],.009)
                for dz in [-.045,-.095]:path([(.56,dz),(.78,dz)],.014)
            elif style==5:
                path([(.4,.075),(.70,.075),(.82,.025),(.82,-.025),(.70,-.075),(.4,-.075)],.012)
                if sign<0:
                    for x in [.49,.61,.73]:path([(x,-.045),(x,.045)],.008)
    for x in [(-.5+k/10)*half*.95 for k in range(11)]:
        points=[]
        for z in [sp['clearance']+.16,sp['clearance']+.33]:
            hit,p,n,_=body.ray_cast(Vector((x,length*.5+1,z)),Vector((0,-1,0)))
            if hit: points.append(p+n*.009)
        if len(points)==2: parts.append(tube('grille_slat','chrome',points,.006,1))
    # Curved inset grille follows this car's bumper, rather than an oversized
    # black rectangle occupying the whole front end.
    vertices=[];faces=[]
    for row,z in enumerate([sp['clearance']+.12,sp['clearance']+.34]):
        for col in range(9):
            x=(col/8-.5)*half*1.15
            hit,p,n,_=body.ray_cast(Vector((x,length*.5+1,z)),Vector((0,-1,0)))
            if not hit:p=Vector((x,length*.5-.03,z));n=Vector((0,1,0))
            vertices.append(tuple(p+n*.003))
    for col in range(8):faces.append((col,col+1,col+10,col+9))
    grille_mesh=bpy.data.meshes.new('inset_grille');grille_mesh.from_pydata(vertices,[],faces);grille_mesh.materials.append(mat('trim'))
    grille_obj=bpy.data.objects.new('inset_grille',grille_mesh);bpy.context.scene.collection.objects.link(grille_obj);parts.append(grille_obj)
    # A dark cabin, dashboard and individual seats are visible through real open glazing.
    cabin_y=((rear+front)*.5-.5)*length
    parts.append(box('cabin_floor','interior',(sp['width']*.78,(front-rear)*length,.06),(0,cabin_y,sp['clearance']+.12),.02))
    parts.append(box('dashboard','interior',(sp['width']*.78,.28,.16),(0,(front-.5)*length-.04,sp['belt']-.11),.035))
    for side in [-1,1]:
        parts.append(box('inner_door_card','interior',(.035,(front-rear)*length,.40),(side*half*.83,cabin_y,sp['belt']-.26),.015))
    bpy.ops.mesh.primitive_torus_add(major_radius=.135,minor_radius=.016,major_segments=32,minor_segments=8,
        location=(-half*.42,(front-.5)*length-.20,sp['belt']-.08),rotation=(math.pi/3,0,0))
    steering=bpy.context.active_object;steering.name='steering_wheel';steering.data.materials.append(mat('interior'));parts.append(steering)
    for t in [rear+.08,middle+.07]:
        for x in [-half*.46,half*.46]:
            y=(t-.5)*length
            parts.append(box('seat_cushion','interior',(.46,.43,.12),(x,y,.45),.045))
            parts.append(box('seat_back','interior',(.46,.14,.50),(x,y-.18,.72),.05))
            parts.append(box('head_rest','interior',(.24,.11,.17),(x,y-.18,1.02),.035))
    return parts


def build(kind,sp):
    namespace['clear']();body=body_shell(sp)
    # Separate windscreen, rear screen, and side glazing for tint/transparency.
    for poly in body.data.polygons:
        if poly.material_index in [5,6]:poly.material_index=0
        if poly.material_index==2 and poly.center.y>sp['length']*.46 and poly.center.z>sp['clearance']+.16:poly.material_index=0
        if poly.material_index==1 and abs(poly.normal.y)>.32:
            poly.material_index=12 if poly.normal.y>0 else 13
        poly.use_smooth=poly.material_index in [0,1,12,13]
    parts=[body]+[p for p in namespace['details'](sp) if not p.name.startswith(('mirror','handle'))]+details(sp,body)
    for axle in sp['axles']:
        for side in [-1,1]: parts+=wheel(sp,side*(sp['width']/2-.13),(axle-.5)*sp['length'],side)
    bpy.ops.object.select_all(action='DESELECT')
    for part in parts: part.select_set(True)
    bpy.context.view_layer.objects.active=body;bpy.ops.object.join()
    return body


blob=bytearray();meta={'version':1,'kinds':{}}
def put(data):
    while len(blob)%4:blob.append(0)
    offset=len(blob);blob.extend(data);return offset
for kind,sp in namespace['SPECS'].items():
    car=build(kind,sp);pos,nor,uv,idx=namespace['export'](car);n=len(pos)//3
    if n>=65536:raise RuntimeError(f'{kind}: vertex budget exceeded ({n})')
    packed_normals=b''.join(struct.pack('<4b',*(max(-127,min(127,round(c*127))) for c in nor[i*3:i*3+3]),0) for i in range(n))
    meta['kinds'][kind]={'label':sp['_label'],'frontDesign':sp['_front'],'rearDesign':sp['_rear'],'length':sp['length'],'width':sp['width'],'height':sp['height'],'verts':n,'index':len(idx),'pos':put(struct.pack(f'<{len(pos)}f',*pos)), 'nor':put(packed_normals),
        'uv':put(struct.pack(f'<{len(uv)}H',*(round(c*65535) for c in uv))),'idx':put(struct.pack(f'<{len(idx)}H',*idx))}
    print(kind,n,'vertices',len(idx)//3,'triangles',flush=True)
(OUT/'cars.bin').write_bytes(blob)
(OUT/'cars.json').write_text(json.dumps(meta,separators=(',',':')),encoding='utf-8')
print('Walk car models:',len(blob),'bytes',flush=True)
