# DJI Mini 2 representative camera-drone audio

Runtime uses this version directory. The previous Phantom recordings and the
initial Mini 2 processing version remain preserved; no old file was deleted.
This represents a small DJI camera quadcopter, not an exact recording of an
unspecified sensor-equipped DJI model or of every DJI product family.

Both source recordings are by **Sadiquecat**, released under **CC0 1.0**:

- Hover: https://freesound.org/people/Sadiquecat/sounds/683298/
  "Dji Mavic Mini 2 hover above ground UP-DOWN XY mic placement Zoom H5.wav"
- Motor start: https://freesound.org/people/Sadiquecat/sounds/683299/
  "Dji Mavic Mini 2 propeller start-up no takeoff Close take.wav"

Public high-quality MP3 previews were downloaded without login on 2026-10-10
from the media links exposed on those pages. They are indoor field recordings
with a Zoom H5 microphone, not official DJI sound assets.

Processing: mono 24 kHz, 16-bit PCM; high-pass 120 Hz and low-pass 5.8 kHz.
Hover uses source 2.0-8.5 s with a 0.5 s equal-power overlap, giving a 6.0 s
continuous loop at RMS 0.105. Start uses 0.5-2.9 s, skipping the initial handling
transient, with 0.09 s fade-in and 0.8 s fade-out. Full parameters and hashes are
in build-info.json; the public source HTML/MP3 and decoded files are retained in
the local review folder. Reproduction: scripts/build-drone-audio.py.

Playback hover rate remains 1.0 at normal hover load, varies smoothly from
0.965 to 1.085 with bounded load/speed, and blends in under the end of the start.
Wind is a quieter filtered procedural layer. Mute, music ducking, hidden-tab
pause, and scene disposal apply to the entire mix, including motor start.

License: https://creativecommons.org/publicdomain/zero/1.0/
