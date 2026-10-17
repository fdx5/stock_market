"""Add tunnel mouths to an existing surface-rail asset version, as a NEW version directory.
Each corridor end that runs on into a tunnel (OSM tunnel / underground / below-ground way at
that end's node, from a saved public Overpass response — tmp/rail-portal/portals.json, made by
walking those ways) gets `portals`: the tunnel's first metres from that end, [lon, lat].
The source version is read only; an existing output directory is refused.
Usage: python scripts/add-rail-portals.py SOURCE_VERSION_DIR PORTALS_JSON NEW_VERSION_DIR
"""
import json, math, shutil, sys
from pathlib import Path

REACH = 400.0  # metres of track past a portal: down a ramp off a viaduct, then under the ground


def metres(a, b):
    return math.hypot((b[0]-a[0])*111320*math.cos(math.radians(a[1])), (b[1]-a[1])*110540)


def cut(points, reach):
    out, walked = [points[0]], 0.0
    for a, b in zip(points, points[1:]):
        d = metres(a, b)
        if walked + d >= reach:
            t = (reach - walked) / d if d else 0
            out.append([round(a[0]+(b[0]-a[0])*t, 7), round(a[1]+(b[1]-a[1])*t, 7)]); return out
        out.append(b); walked += d
    return out


def main(source, portals_file, output):
    if output.exists(): raise SystemExit('Existing asset directory preserved; choose a new version directory.')
    portals = json.loads(portals_file.read_text(encoding='utf8'))
    shutil.copytree(source, output)
    added = 0
    for f in (output/'corridors').glob('*.json'):
        c = json.loads(f.read_text(encoding='utf8'))
        found = []
        for p in portals.get(c['id'], []):
            end_point = c['points'][0 if p['end'] == 0 else -1]
            if metres(end_point, p['points'][0]) > .5: continue  # (the snapshot's end moved since)
            # (a tunnel out again on the other side: half of it from each end)
            reach = min(REACH, p['length']/2) if p['kind'] == 'through' else REACH
            pts = cut(p['points'], reach)
            if len(pts) > 1: found.append(dict(end=p['end'], points=pts))
        if found:
            c['portals'] = found; added += len(found)
            f.write_text(json.dumps(c, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    m = json.loads((output/'manifest.json').read_text(encoding='utf8'))
    m['stats']['tunnelPortals'] = added
    m['portals'] = 'tunnel mouths from OpenStreetMap tunnel ways at corridor ends (2026-10-17); track drawn up to 400 m in'
    (output/'manifest.json').write_text(json.dumps(m, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    print(json.dumps({'portals': added}))


if __name__ == '__main__': main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
