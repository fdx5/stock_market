"""Page turns for the book reader (public/3d/walk/sfx/page1..6.mp3): BigSoundBank CC0 recordings
"Pages that turn #1" (s0493, five turns of a paperback) and "#5" (s2212), each turn cut at its onset,
trimmed, faded and levelled. usage: python prepare-page-turns.py <dir with 0493.mp3 and 2212.mp3>"""
import os, sys, numpy as np, soundfile as sf, scipy.signal as ss
SR = 44100; src = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "3d", "walk", "sfx")
def load(p):
    x, sr = sf.read(p, always_2d=True); x = x.mean(1)
    return ss.resample_poly(x, SR, sr) if sr != SR else x
def turns(x, n_max):
    env = ss.lfilter([0.002], [1, -0.998], np.abs(x)); thr = env.max() * 0.12
    on = np.where((env[1:] > thr) & (env[:-1] <= thr))[0]; cuts = []
    for o in on:
        if cuts and o - cuts[-1] < int(0.8 * SR): continue
        cuts.append(o)
    out = []
    for o in cuts[:n_max]:
        a = max(0, o - int(0.04 * SR)); seg = x[a:a + int(1.3 * SR)]
        e = ss.lfilter([0.002], [1, -0.998], np.abs(seg)); end = np.where(e > e.max() * 0.03)[0]
        seg = seg[: (end[-1] + int(0.08 * SR)) if len(end) else len(seg)]
        seg = ss.sosfilt(ss.butter(2, 120, "highpass", fs=SR, output="sos"), seg)
        n = len(seg); f = np.ones(n); f[:int(0.004 * SR)] = np.linspace(0, 1, int(0.004 * SR)); k = int(0.12 * SR); f[-k:] *= np.linspace(1, 0, k) ** 2
        out.append(seg * f / (np.abs(seg).max() + 1e-9) * 0.8)
    return out
clips = turns(load(os.path.join(src, "0493.mp3")), 5) + turns(load(os.path.join(src, "2212.mp3")), 1)
for i, c in enumerate(clips, 1):
    sf.write(os.path.join(OUT, f"page{i}.mp3"), c.astype(np.float32), SR, format="MP3", subtype="MPEG_LAYER_III", compression_level=0.3)
    print(f"page{i}.mp3 {len(c) / SR:.2f}s")
