"""Independent image fixtures and known areas; no application startup, DB or cleanup."""
import io
import math

import cv2
import numpy as np
import pytest
from PIL import Image, ImageDraw

from test_floorplan_pipeline import drawn_flat
from app.services.floorplan_image_analysis import analyze_image
from app.services.floorplan_geometry import read_areas, fit_area_scale, source_match


def word(text, x, y, w=30, h=12):
    return dict(text=text, x=x, y=y, w=w, h=h, confidence=98, rotation=0)


@pytest.mark.parametrize('monochrome,faded', [(False,False),(True,False),(True,True)])
@pytest.mark.parametrize('split', [280,300,320,340])
def test_dimensionless_plans_preserve_source_footprint_above_95_percent(monochrome,faded,split):
    data,words=drawn_flat(split)
    words=[w for w in words if not w['text'].isdigit()]
    if monochrome:
        pixels=np.asarray(Image.open(io.BytesIO(data)).convert('RGB'))
        black=pixels.max(axis=2)<75
        out=np.full_like(pixels,255);out[black]=150 if faded else 0
        encoded=io.BytesIO();Image.fromarray(out).save(encoded,format='PNG');data=encoded.getvalue()
    result=analyze_image(data,63,words=words)
    assert result['status']=='ready',result.get('reason')
    assert result['scale']['basis']=='exclusive_area_ratio'
    assert result['scale']['estimated']
    assert result['scale']['xMetresPerPixel']==result['scale']['zMetresPerPixel']
    assert abs(result['areaM2']-63)<.02
    mask=np.zeros((640,800),np.uint8)
    for room in result['pixelRooms']:
        x0,y0,x1,y1=map(round,room['rect']);mask[y0:y1,x0:x1]=1
    truth=np.zeros_like(mask);truth[100:520,100:640]=1
    iou=float((mask&truth).sum()/(mask|truth).sum())
    assert iou>=.95,iou  # Known source footprint, not self-reported confidence.
    assert sum(r['type'] in ('master','bedroom') for r in result['rooms'])==2
    assert result['checks']['connected']


def test_room_area_labels_calibrate_scale_without_stretching_rooms():
    data,words=drawn_flat()
    words=[w for w in words if not w['text'].isdigit()]
    words += [word('12.22㎡',200,440),word('10.56m²',550,230)]
    result=analyze_image(data,63,words=words)
    assert result['status']=='ready',result
    assert result['scale']['basis']=='room_area_ratio'
    assert len(result['areaConstraints'])==2
    assert max(c['relativeResidual'] for c in result['areaConstraints'])<.05
    assert abs(result['areaM2']/63-1)<.05
    assert result['scale']['xMetresPerPixel']==result['scale']['zMetresPerPixel']
    conflict=analyze_image(data,63,words=words[:-1]+[word('26.56m²',550,230)])
    assert conflict['status']=='ready'
    assert conflict['application']['areaAnnotationAdjusted']
    assert conflict['scale']['basis']=='exclusive_area_ratio'
    assert conflict['pixelRooms']==result['pixelRooms'],'annotation corrections cannot alter source room positions'
    assert abs(conflict['areaM2']-63)<.02


def test_only_unit_bearing_areas_are_used_and_fragmented_units_are_joined():
    areas=read_areas([word('전용 84.97㎡',50,30),word('12.5',200,200),word('㎡',225,200,10),
                     word('3.2평',300,300),word('9000',250,400),word('84A',260,410)],(100,100,600,500))
    assert len(areas)==3
    assert areas[0]['scope']=='exclusive'
    assert areas[1]['areaM2']==12.5
    assert abs(areas[2]['areaM2']-10.5785)<.001


def test_decimal_area_without_units_requires_a_nearby_room_label():
    areas=read_areas([word('침실',200,180),word('9.09',200,202),word('84.9',400,400),word('9000',200,225)],(100,100,600,500))
    assert len(areas)==1 and areas[0]['areaM2']==9.09
    assert areas[0]['unitBasis']=='room_label_decimal'


def test_combined_living_bedroom_label_keeps_the_living_anchor():
    data,words=drawn_flat()
    words=[w for w in words if not w['text'].isdigit()]
    words[0]['text']='거실 및 침실'
    result=analyze_image(data,63,words=words)
    assert result['status']=='ready',result.get('reason')
    assert any(r['type']=='living' and r['combinedUses']==['living','bedroom'] for r in result['rooms'])


@pytest.mark.parametrize('labels',[('거 실 / 침 실','주 방','욕 실'),('LIVING / BEDROOM','KITCHEN','BATHROOM'),('거실겸 참실','주방 및 식당','욕실')])
def test_source_studio_does_not_require_an_invented_separate_bedroom(labels):
    image=Image.new('RGB',(480,360),'white');d=ImageDraw.Draw(image)
    d.rectangle((30,30,440,320),fill='#c99852',outline='black',width=6)
    d.rectangle((30,210,135,320),fill='#aacddd',outline='black',width=6)
    d.rectangle((131,250,140,290),fill='#c99852')
    encoded=io.BytesIO();image.save(encoded,format='PNG')
    result=analyze_image(encoded.getvalue(),25,words=[word(labels[0],290,160),word(labels[1],100,85),word(labels[2],85,265)])
    assert result['status']=='ready',result
    assert any(r['type']=='living' and 'bedroom' in r['combinedUses'] for r in result['rooms'])
    assert not any(r['type'] in ('bedroom','master') for r in result['rooms'])
    assert not result['application']['templateUsed']


def test_open_kitchen_dining_room_can_supply_an_explicitly_inferred_living_use():
    data,words=drawn_flat()
    words=[w for w in words if not w['text'].isdigit() and w['text']!='거실']
    result=analyze_image(data,63,words=words)
    assert result['status']=='ready',result.get('reason')
    living=next(r for r in result['rooms'] if r['type']=='living')
    assert not living['labelObserved']


def test_floor_coverage_prevents_omitted_rooms_from_receiving_a_95_match():
    wall=np.zeros((500,600),np.uint8)
    cv2.rectangle(wall,(50,50),(550,450),255,5)
    cv2.line(wall,(300,50),(300,450),255,5)
    floor=np.zeros_like(wall,dtype=bool);floor[50:450,50:550]=True
    result=source_match(wall,[{'id':'a'}],[],[50,300,550],[50,450],[{'grid':[0,0,1,1],'rect':[0,0,5,8]}],(50,50,550,450),floor)
    assert result['floorCoverage']<.55
    assert not result['targetMet']


def test_small_observed_door_keeps_its_pixel_width_instead_of_a_standard_width():
    data,words=drawn_flat();im=Image.open(io.BytesIO(data)).convert('RGB');draw=ImageDraw.Draw(im)
    draw.rectangle((450,100,455,300),fill='black')
    draw.rectangle((446,225,456,249),fill='#c99852')
    draw.line((450,225,478,225),fill='#666666',width=1)
    out=io.BytesIO();im.save(out,format='PNG')
    result=analyze_image(out.getvalue(),63,words=[w for w in words if not w['text'].isdigit()])
    assert result['status']=='ready',result.get('reason')
    narrow=[o for o in result['openings'] if o['type']=='door' and .30<o['width']<.50]
    assert narrow,'retain the observed small gap, without increasing it to a standard door size'
    assert result['checks']['narrowDoorways']>=1


def test_kitchen_dining_anchors_do_not_create_duplicate_room_ids():
    data,words=drawn_flat()
    result=analyze_image(data,63,words=words+[word('식당',400,200)])
    assert result['status']=='ready',result.get('reason')
    ids=[r['id'] for r in result['rooms']]
    assert len(ids)==len(set(ids))
    assert sum(r['type']=='kitchen' for r in result['rooms'])==1


def test_l_shaped_zone_area_and_balcony_exclusion():
    # The first room is L-shaped (3 cells); the right-hand strip is a balcony.
    cells={(0,0):{},(1,0):{},(0,1):{},(1,1):{},(2,0):{},(2,1):{}}
    assigned={(0,0):0,(1,0):0,(0,1):0,(1,1):1,(2,0):2,(2,1):2}
    seeds=[{'type':'living'},{'type':'bedroom'},{'type':'balcony'}]
    xs=[0,100,200,250];ys=[0,100,200]
    scale,proof,conflict=fit_area_scale([dict(word('12㎡',20,20),areaM2=12,scope='room')],cells,assigned,seeds,xs,ys,16)
    assert not conflict and math.isclose(scale,.02)
    assert proof[0]['pixelArea']==30000
    # No label: calibrate 16m² to 40,000 usable pixels, excluding 10,000 balcony.
    fallback,_,_=fit_area_scale([],cells,assigned,seeds,xs,ys,16)
    assert math.isclose(fallback,.02)


def test_source_metric_rejects_moved_partition_instead_of_reporting_95():
    wall=np.zeros((500,600),np.uint8)
    cv2.rectangle(wall,(50,50),(550,450),255,5)
    cv2.line(wall,(300,50),(300,450),255,5)
    def measure(split):
        xs=[50,split,550];ys=[50,450]
        rects=[{'grid':[0,0,1,1],'rect':[0,0,5,8]},{'grid':[1,0,2,1],'rect':[5,0,10,8]}]
        return source_match(wall,[{'id':'a'},{'id':'b'}],[],xs,ys,rects,(50,50,550,450))
    correct=measure(300);shifted=measure(400)
    assert correct['wallF1']>=.95 and correct['targetMet']
    assert shifted['wallF1']<.95 and not shifted['targetMet']
    assert not correct['certifiedAccuracy']


@pytest.mark.parametrize('area',[0,-1,float('nan'),float('inf'),None])
def test_invalid_area_cannot_generate_a_scaled_flat(area):
    data,words=drawn_flat()
    assert analyze_image(data,area,words=words)['reason']=='exclusive_area'
