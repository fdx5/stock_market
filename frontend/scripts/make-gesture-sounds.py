"""The gestures' sounds (public/3d/walk/sfx/gesture/<name>.mp3): a bright spoken line for each
(MeloTTS Korean, MIT — voices made beforehand by tts-gesture-lines.py into a cache), mixed with its
sound: CC0 recordings from BigSoundBank (applause, cheering, children's laughter, a whoosh) and
sounds made here (two short pop loops for the dances, robot beeps, a jump's boing, a message ding,
a ringtone, a watch's tick, a sparkle, a camera shutter, a stomp).

usage: python make-gesture-sounds.py <voice_cache_dir> <cc0_dir>"""
import os, sys, numpy as np, soundfile as sf, scipy.signal as ss

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "public", "3d", "walk", "sfx", "gesture")
VOICES, CC0 = sys.argv[1], sys.argv[2]
rng = np.random.default_rng(11)

# ----------------------------------------------------------------- tools
def load(path):
    x, sr = sf.read(path, always_2d=True); x = x.mean(axis=1)
    if sr != SR: x = ss.resample_poly(x, SR, sr)
    return x.astype(np.float64)
def trim(x, thr=0.01):
    a = np.abs(x); idx = np.where(a > thr * a.max())[0]
    return x[max(0, idx[0] - 200): idx[-1] + 2000] if len(idx) else x
def fade(x, i=0.005, o=0.08):
    n1, n2 = int(i * SR), min(len(x), int(o * SR)); x = x.copy()
    x[:n1] *= np.linspace(0, 1, n1); x[len(x) - n2:] *= np.linspace(1, 0, n2) ** 2; return x
def shelf(x, f, db, kind="high"):
    """RBJ shelving biquad"""
    A = 10 ** (db / 40); w = 2 * np.pi * f / SR; al = np.sin(w) / 2 * np.sqrt(2); c = np.cos(w); s = 1 if kind == "high" else -1
    b = [A * ((A + 1) + s * (A - 1) * c + 2 * np.sqrt(A) * al), -2 * s * A * ((A - 1) + s * (A + 1) * c), A * ((A + 1) + s * (A - 1) * c - 2 * np.sqrt(A) * al)]
    a = [(A + 1) - s * (A - 1) * c + 2 * np.sqrt(A) * al, 2 * s * ((A - 1) - s * (A + 1) * c), (A + 1) - s * (A - 1) * c - 2 * np.sqrt(A) * al]
    return ss.lfilter(b, a, x)
def comp(x, thr=0.25, ratio=3.0):
    env = ss.lfilter([0.01], [1, -0.99], np.abs(x)) + 1e-9
    g = np.where(env > thr, (thr + (env - thr) / ratio) / env, 1.0)
    return x * g
def norm(x, peak=0.89): return x / (np.abs(x).max() + 1e-9) * peak
def bright_voice(x):
    """a bright, present voice: a touch higher (4%), air above 5 kHz, presence at 3 kHz, no mud, evened out"""
    x = ss.resample_poly(x, 100, 104)               # +4% pitch (and pace)
    x = ss.sosfilt(ss.butter(2, 90, "highpass", fs=SR, output="sos"), x)
    x = shelf(x, 250, -2.5, "low"); x = shelf(x, 3500, 2.0, "high")
    pk = ss.iirpeak(2500 / (SR / 2), 1.0); x = x + 0.15 * ss.lfilter(*pk, x)
    # de-ess: the 5–10 kHz band held down where it leaps (ㅊ, ㅅ, ㅆ), then a soft top above 12 kHz
    band = ss.sosfilt(ss.butter(2, [5000, 10000], "bandpass", fs=SR, output="sos"), x)
    be = ss.lfilter([0.02], [1, -0.98], np.abs(band)); te = ss.lfilter([0.02], [1, -0.98], np.abs(x)) + 1e-6
    over = np.clip(be / te - 0.18, 0, None) / 0.18; x = x - band * np.clip(over, 0, 0.7)
    x = ss.sosfilt(ss.butter(2, 12000, "lowpass", fs=SR, output="sos"), x)
    return fade(norm(comp(norm(x), 0.3, 3.0)))
def at(dst, src, t, gain=1.0):
    i = int(t * SR); n = min(len(src), len(dst) - i)
    if n > 0: dst[i:i + n] += src[:n] * gain
    return dst
def env_adsr(n, a=0.005, d=0.1, s=0.5, r=0.1):
    t = np.arange(n) / SR; e = np.minimum(1, t / max(a, 1e-4)); e = np.where(t > a, s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)), e)
    rl = int(r * SR); e[-rl:] *= np.linspace(1, 0, rl) if rl < n else 1; return e
def tone(f, dur, kind="sine", a=0.005, d=0.15, s=0.3, r=0.05):
    n = int(dur * SR); t = np.arange(n) / SR; ph = 2 * np.pi * np.cumsum(np.full(n, f) if np.isscalar(f) else f) / SR
    w = np.sin(ph) if kind == "sine" else np.sign(np.sin(ph)) * 0.6 if kind == "square" else (2 * ((ph / (2 * np.pi)) % 1) - 1) * 0.6
    return w * env_adsr(n, a, d, s, r)

# ----------------------------------------------------------------- made sounds
def kick():
    n = int(0.35 * SR); t = np.arange(n) / SR; f = 50 + 120 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9) * 0.9
def clap_hit():
    n = int(0.2 * SR); t = np.arange(n) / SR; nz = rng.normal(0, 1, n)
    e = sum(np.exp(-np.maximum(0, t - k * 0.011) * 60) * (t >= k * 0.011) for k in range(3)) + np.exp(-t * 18) * 0.6
    return ss.sosfilt(ss.butter(2, [900, 4000], "bandpass", fs=SR, output="sos"), nz) * e * 0.6
def hat():
    n = int(0.06 * SR); return ss.sosfilt(ss.butter(2, 7000, "highpass", fs=SR, output="sos"), rng.normal(0, 1, n)) * np.exp(-np.arange(n) / SR * 70) * 0.25
def pop_loop(bpm=118, key=0, bars=4, flavour=0):
    """a bright pop loop: four-on-the-floor, claps on 2 and 4, offbeat hats, a bouncy bass and
    plucked saw chords I–V–vi–IV (or a minor-ish groove), a little stereo-free sparkle on top"""
    beat = 60 / bpm; L = bars * 4 * beat; y = np.zeros(int(L * SR) + SR)
    roots = [0, 7, 9, 5] if flavour == 0 else [9, 5, 0, 7]
    base = 261.63 * 2 ** (key / 12)
    for bar in range(bars):
        r = roots[bar % 4]; chord = [r, r + (3 if r in (9, 2) else 4), r + 7]
        for b in range(4):
            t0 = (bar * 4 + b) * beat
            at(y, kick(), t0, 0.9)
            if b % 2: at(y, clap_hit(), t0, 0.8)
            at(y, hat(), t0 + beat / 2, 1.0)
            # bass: root, octave bounce
            for k, o in enumerate([0, 12 if flavour == 0 else 7]):
                f = base / 4 * 2 ** ((r + o) / 12); at(y, ss.sosfilt(ss.butter(2, 900, "lowpass", fs=SR, output="sos"), tone(f, beat * 0.45, "saw", 0.003, 0.08, 0.4, 0.04)), t0 + k * beat / 2, 0.5)
            # chord stabs on the offbeats (plucked, filtered saws)
            for s in ([0.5] if flavour == 0 else [0.25, 0.75]):
                st = sum(tone(base * 2 ** (c / 12), beat * 0.3, "saw", 0.002, 0.07, 0.15, 0.05) for c in chord)
                at(y, ss.sosfilt(ss.butter(2, 3200, "lowpass", fs=SR, output="sos"), st), t0 + s * beat, 0.32)
        # a sparkle line on top (pentatonic)
        for k in range(8):
            n = [0, 2, 4, 7, 9, 12, 9, 7][(k + bar * 3) % 8]
            at(y, tone(base * 2 * 2 ** ((r + n) / 12), beat * 0.4, "sine", 0.002, 0.12, 0.1, 0.05), (bar * 4 + k * 0.5) * beat, 0.16)
    y = y[:int(L * SR)]
    return fade(norm(comp(norm(y), 0.4, 2.5), 0.8), 0.01, 0.3)
def robot():
    y = np.zeros(int(1.6 * SR))
    for k, f in enumerate([880, 660, 990, 1320, 740, 1100]):
        at(y, tone(f, 0.11, "square", 0.002, 0.05, 0.6, 0.02), k * 0.13, 0.35)
    q = np.round(y * 12) / 12; return fade(norm(q, 0.7))
def boing():
    n = int(0.6 * SR); t = np.arange(n) / SR; f = 220 + 520 * (1 - np.exp(-t * 9)) + 18 * np.sin(2 * np.pi * 14 * t)
    return fade(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4.5) * 0.7)
def ding():
    y = np.zeros(int(0.9 * SR))
    for k, f in enumerate([1318.5, 1975.5]):
        at(y, sum(tone(f * m, 0.8, "sine", 0.001, 0.25, 0.0, 0.1) * g for m, g in [(1, 1), (2.76, 0.25), (5.4, 0.08)]), k * 0.12, 0.5)
    return fade(y)
def ringtone():
    y = np.zeros(int(1.6 * SR))
    for rep in range(2):
        for k, n in enumerate([0, 4, 7, 12, 7, 4]):
            at(y, sum(tone(523.25 * 2 ** (n / 12) * m, 0.18, "sine", 0.002, 0.08, 0.1, 0.05) * g for m, g in [(1, 1), (4, 0.2)]), rep * 0.8 + k * 0.11, 0.45)
    return fade(y)
def tick():
    y = np.zeros(int(1.2 * SR))
    for k in range(4):
        c = ss.sosfilt(ss.butter(2, 3000, "highpass", fs=SR, output="sos"), rng.normal(0, 1, int(0.012 * SR))) * np.exp(-np.arange(int(0.012 * SR)) / SR * 400)
        at(y, c, k * 0.3, 0.5 if k % 2 else 0.35)
    return y
def sparkle():
    y = np.zeros(int(1.0 * SR))
    for k in range(9):
        at(y, tone(1568 * 2 ** ((k * 2) / 12), 0.35, "sine", 0.001, 0.12, 0.0, 0.08), k * 0.045, 0.22)
    return fade(y)
def shutter():
    y = np.zeros(int(0.35 * SR))
    for k, t in enumerate([0, 0.09]):
        n = int(0.03 * SR); c = ss.sosfilt(ss.butter(2, [1500, 6000], "bandpass", fs=SR, output="sos"), rng.normal(0, 1, n)) * np.exp(-np.arange(n) / SR * 120)
        at(y, c, t, 0.8 if k == 0 else 0.55)
    return y
def stomp():
    y = np.zeros(int(0.9 * SR))
    for k in range(3):
        n = int(0.18 * SR); t = np.arange(n) / SR
        th = np.sin(2 * np.pi * np.cumsum(70 + 60 * np.exp(-t * 40)) / SR) * np.exp(-t * 22) + ss.sosfilt(ss.butter(2, 800, "lowpass", fs=SR, output="sos"), rng.normal(0, 1, n)) * np.exp(-t * 35) * 0.3
        at(y, th, k * 0.27, 0.8)
    return y

# ----------------------------------------------------------------- the CC0 recordings
def rec(sid, start=0.0, dur=None, gain=1.0, hp=None):
    x = load(os.path.join(CC0, f"{sid}.mp3"))
    x = x[int(start * SR): int((start + dur) * SR) if dur else None]
    if hp: x = ss.sosfilt(ss.butter(2, hp, "highpass", fs=SR, output="sos"), x)
    return fade(norm(x, 0.9) * gain, 0.01, 0.4)
APPLAUSE = lambda: rec("2479", 0.3, 3.2, 0.55)
CHEER = lambda: rec("0236", 0.0, 3.0, 0.6)
KIDS = lambda: rec("1660", 0.0, 2.6, 0.32)
WHOOSH = lambda: rec("1797", 0.0, None, 0.5, 300)

# ----------------------------------------------------------------- each gesture: [line, sound, where the voice comes in]
PLAN = {
    "wave": (None, WHOOSH, 0.05), "bow": (None, None, 0), "deepBow": (None, None, 0), "nod": (None, None, 0), "shake": (None, None, 0),
    "clap": (None, APPLAUSE, 0.6), "cheer": (None, CHEER, 0.15), "point": (None, None, 0), "shrug": (None, None, 0), "salute": (None, None, 0),
    "think": (None, None, 0), "phone": (None, ringtone, 1.65), "lookPhone": (None, ding, 0.55), "watch": (None, tick, 0.5), "scratch": (None, None, 0),
    "crossArms": (None, None, 0), "handsHips": (None, None, 0), "stretch": (None, None, 0), "yawn": (None, None, 0), "facepalm": (None, None, 0),
    "laugh": (None, KIDS, 0.0), "cry": (None, None, 0), "angry": (None, stomp, 0.2), "thumbsUp": (None, sparkle, 0.1), "heart": (None, sparkle, 0.05),
    "peace": (None, None, 0), "dance": (None, lambda: pop_loop(122, 0, 4, 0), 0.4), "robot": (None, robot, 1.5), "groove": (None, lambda: pop_loop(104, 5, 4, 1), 0.4),
    "jump": (None, boing, 0.05), "beckon": (None, None, 0), "stop": (None, None, 0), "lookAround": (None, None, 0), "kick": (None, WHOOSH, 0.0), "shy": (None, sparkle, 0.3),
}
os.makedirs(OUT, exist_ok=True)
total = 0
for name, (_, snd, vin) in PLAN.items():
    v = os.path.join(VOICES, f"{name}.wav")
    voice = bright_voice(load(v)) if os.path.exists(v) else None
    s = snd() if snd else None
    music = name in ("dance", "groove")
    if name == "peace" and voice is not None:
        # (the shutter after "브이~! 찰칵!")
        s = np.zeros(len(voice) + int(0.4 * SR)); at(s, shutter(), len(voice) / SR - 0.1, 1.0)
    L = max(len(s) if s is not None else 0, int(vin * SR) + (len(voice) if voice is not None else 0)) + int(0.05 * SR)
    y = np.zeros(L)
    if s is not None: at(y, s, 0.0, 0.6 if music else 0.9)
    if voice is not None:
        # (the voice over the sound: the bed ducked under it)
        if s is not None and music:
            i0, i1 = int(vin * SR), int(vin * SR) + len(voice); duck = np.ones(L); duck[i0:i1] = 0.55; duck = ss.lfilter([0.002], [1, -0.998], duck) / ss.lfilter([0.002], [1, -0.998], np.ones(L)); y *= duck
        at(y, voice, vin, 1.0)
    y = fade(norm(comp(norm(y), 0.45, 2.2), 0.9), 0.003, 0.25)
    path = os.path.join(OUT, f"{name}.mp3")
    sf.write(path, y.astype(np.float32), SR, format="MP3", subtype="MPEG_LAYER_III", compression_level=0.35)
    total += os.path.getsize(path)
    print(f"{name:11s} {len(y) / SR:5.2f}s voice={'y' if voice is not None else '-'}")
print(f"total {total / 1024:.0f} KB")
