"""Independent in-memory fixtures only. No application startup and no database."""
import os
import unittest
from unittest.mock import patch
from app.services import sgis_indoor as s

class SgisIndoorTests(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{"SGIS_CONSUMER_KEY":"fixture-key","SGIS_CONSUMER_SECRET":"fixture-secret"});self.env.start()
        self.cache=patch.object(s,"_cache",s.OrderedDict());self.cache.start()
        self.token=patch.object(s,"_token",("",0));self.token.start()
    def tearDown(self):
        self.token.stop();self.cache.stop();self.env.stop()
    def test_credentials_never_returned_and_token_reused(self):
        class Response:
            def raise_for_status(self):pass
            def json(self):return {"errCd":0,"result":{"accessToken":"fixture-token","accessTimeout":s.time.time()+3000}}
        with patch.object(s.requests,"get",return_value=Response()) as req:
            self.assertEqual(s._access_token(),"fixture-token");s._access_token();self.assertEqual(req.call_count,1)
        with patch.object(s,"_request",return_value={"features":[]}):
            result=s.building(37.488298,127.085151)
        self.assertEqual(result['status'],'not_covered');self.assertNotIn('fixture',str(result))
    def test_no_neighbouring_building_match(self):
        x,y=s._to_grid.transform(127.085151,37.488298)
        def feature(dx):return {"geometry":{"type":"Polygon","coordinates":[[[x+dx-8,y-8],[x+dx+8,y-8],[x+dx+8,y+8],[x+dx-8,y+8],[x+dx-8,y-8]]]},"properties":{"sufid":"201009627135471957239550","bd_nm":"Fixture"}}
        with patch.object(s,"_request",return_value={"features":[feature(50)]}):self.assertEqual(s.building(37.488298,127.085151)['status'],'not_covered')
        s._cache.clear() # in-memory fixture cache only
        with patch.object(s,"_request",return_value={"features":[feature(0)]}):
            got=s.building(37.488298,127.085151);self.assertEqual(got['status'],'available');self.assertAlmostEqual(got['frame']['width'],16)
    def test_missing_floor_is_explicit(self):
        with patch.object(s,"_request",return_value={"features":[]}):self.assertEqual(s.floor("201009627135471957239550",1)['status'],'not_covered')
    def test_partial_provider_failure_preserves_measured_boundary(self):
        ring=[[100,100],[120,100],[120,120],[100,120],[100,100]]
        def request(path,**kwargs):
            if path=='floorboundary.geojson':return {"features":[{"geometry":{"type":"Polygon","coordinates":[ring]}}]}
            raise s.ProviderError()
        with patch.object(s,"_request",side_effect=request):
            got=s.floor("201009627135471957239550",-1)
        self.assertEqual(got['status'],'available');self.assertEqual(got['outlines'][0][0],ring);self.assertFalse(got['partitionsAvailable']);self.assertEqual(got['companies'],[])
    def test_auth_failure_redacts_request_url(self):
        with patch.object(s.requests,"get",side_effect=s.requests.RequestException('secret URL')):
            result=s.building(37.488298,127.085151)
        self.assertEqual(result['status'],'auth_error');self.assertNotIn('secret',str(result))
    def test_epsg_round_trip(self):
        x,y=s._to_grid.transform(127.085151,37.488298);lon,lat=s._to_geo.transform(x,y)
        self.assertAlmostEqual(lon,127.085151,places=7);self.assertAlmostEqual(lat,37.488298,places=7)

if __name__=='__main__':unittest.main()
