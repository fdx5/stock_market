"""Public image reference content and generic lookup; no DB or network."""
import pytest
from app.services import floorplan_references as r
from app.services import realestate_floorplans as sources

def test_public_reference_is_location_bound_and_discloses_approximation():
    catalogue=sources.catalogue('수서1단지에스에이치빌',37.49172,127.08855,'일원동','11680',pnu='1168011400107110000')
    assert catalogue['status']=='available'
    assert r.lookup('수서1단지SH빌',37.49172,127.08855,'수서동','11680') is None
    assert r.lookup('수서1단지SH빌',35,129,'일원동','11680') is None
    assert r.lookup('수서1-2단지',37.49172,127.08855,'일원동','11680') is None
    assert r.lookup('수서1단지에스에이치빌 114',37.49172,127.08855,'일원동','11680','1168011400107110000') is not None
    for drawing in catalogue['plans']:
        analysis=sources.analyze(drawing['naverId'],drawing['key'])
        data,mime=sources.image(drawing['naverId'],drawing['key'])
        assert len(data)>20000 and mime=='image/jpeg'
        assert analysis['status']=='ready'
        assert analysis['application']['geometryBasis']=='reviewed_public_drawing_copy'
        assert analysis['application']['templateUsed'] is False
        assert '사본' in analysis['note'] and '근사' in analysis['note']
        assert 'sourceMatch' not in analysis,'a manual reference must not invent an OCR accuracy score'
        assert len(analysis['pixelRooms'])==len(analysis['rooms'])
        assert analysis['scale']['xMetresPerPixel']==analysis['scale']['zMetresPerPixel']
    with pytest.raises(LookupError):sources.image(catalogue['naverId'],'0'*24)
