# Drone sounds (3D view 드론 mode)

The current local runtime uses the new [DJI Mini 2 recording version](mini2-20261010-v2/SOURCES.md).
The Phantom files below and the initial `mini2-20261010` processing are preserved
as source history. Both Mini 2 versions derive from the two CC0 recordings linked
in the current version notice; their individual hashes are in build-info.json.

Both are cut from one recording released under **CC0 1.0** (public domain) on Freesound:
"il mio drone Phantom 4 pro, prova eliche silenzio..." by andreauomogatto —
https://freesound.org/people/andreauomogatto/sounds/616123/ (a DJI Phantom 4 Pro with its
low-noise propellers). Cut with ffmpeg, high-passed 80 Hz, low-passed 4.2 kHz, mono 24 kHz.

| file | part |
|---|---|
| hover.wav | 196–204.6 s, looped with a 0.5 s equal-power crossfade |
| start.wav | 188.2–190.6 s (the motors spinning up), faded out |

## sky.jpg (the drone's daytime clouds)

"Kloofendal 48d Partly Cloudy (Pure Sky)" by Greg Zaal, Poly Haven — https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky
**CC0 1.0**. Its tonemapped JPG, the upper hemisphere only (equirectangular, elevation 90° at the
top row to 0° at the bottom), 4096 × 1024. The sun in it: u ≈ 0.597, elevation ≈ 51° — the view turns
the picture so that sun lies where its own sun is, and stretches the elevations to match (ComplexRenderer).
