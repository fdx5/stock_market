"""Pure importer checks. No output mutation, database or network."""
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('builder',Path(__file__).with_name('build-surface-rail.py'))
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
class SurfaceFilter(unittest.TestCase):
    def test_tunnels_and_negative_layers_are_excluded(self):
        for t in [{'railway':'rail','tunnel':'yes'},{'railway':'rail','layer':'-1'},{'railway':'subway'},{'railway':'rail','location':'underground'}]:self.assertIsNone(builder.surface_kind(t))
    def test_verified_surface_metro_and_viaduct_are_kept(self):
        self.assertEqual(builder.surface_kind({'railway':'subway','tunnel':'no'}),0)
        self.assertEqual(builder.surface_kind({'railway':'subway','bridge':'yes','layer':'1'}),1)
    def test_worksites_and_yards_are_excluded(self):
        for t in [{'railway':'construction'},{'railway':'rail','construction':'yes'},{'railway':'rail','service':'yard'}]:self.assertIsNone(builder.surface_kind(t))
    def test_busans_rubber_rail_system_is_not_a_steel_wheel_metro(self):
        p=builder.line_info({'name':'부산 도시철도 4호선','ref':'4','route':'monorail'})
        self.assertEqual((p['mode'],p['cars'],p['width']),('agt',6,2.4))
    def test_yongin_is_one_car_and_branches_keep_short_consists(self):
        p=builder.line_info({'name':'용인 경전철','ref':'용인','route':'light_rail'});self.assertEqual(p['cars'],1)
        p=builder.line_info({'name':'서울 지하철 2호선 성수지선','ref':'2','route':'subway'});self.assertEqual(p['cars'],4);self.assertTrue(p['id'].endswith(':성수지선'))
    def test_destination_names_do_not_change_the_operator_region(self):
        p=builder.line_info({'name':'수도권 전철 1호선: 인천 → 연천','route':'subway'})
        self.assertEqual((p['id'],p['cars']),('수도권:1',10))
    def test_uijeongbu_destination_does_not_overwrite_the_u_line_profile(self):
        for name in ['수도권 전철 1호선: 서울역 → 의정부','수도권 전철 1호선 경인·경원 계통: 의정부 → 인천']:
            p=builder.line_info({'name':name,'ref':'1','route':'subway'})
            self.assertEqual((p['id'],p['mode'],p['cars']),('수도권:1','emu',10))
        p=builder.line_info({'name':'의정부경전철: 발곡 → 탑석','ref':'U','route':'light_rail'})
        self.assertEqual((p['id'],p['mode'],p['cars'],p['vehicle']),('수도권:의정부','agt',2,'val208'))
        self.assertEqual((p['gauge'],p['width']), (1.62,2.08))
unittest.main()
