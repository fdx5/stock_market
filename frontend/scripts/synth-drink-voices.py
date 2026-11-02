"""A male '캬~' (and '음~') after a drink, made by source-filter synthesis (Klatt-style cascade):
a glottal pulse train with jitter/shimmer and breath noise, time-varying formant resonators, an
aspirated velar burst for ㅋ, a /j/→/a/ glide, a satisfied falling pitch and a breathy exhale."""
import numpy as np, scipy.io.wavfile as wav, scipy.signal as ss, sys, os
SR = 44100
rng = np.random.default_rng(7)

def interp(t, pts):
    xs, ys = zip(*pts); return np.interp(t, xs, ys)

def resonate(x, F, B):
    """two-pole resonator with per-sample frequency/bandwidth (Klatt), unity gain at DC"""
    y = np.zeros_like(x); y1 = y2 = 0.0
    C = -np.exp(-2 * np.pi * B / SR); Bc = 2 * np.exp(-np.pi * B / SR) * np.cos(2 * np.pi * F / SR); A = 1 - Bc - C
    for n in range(len(x)):
        v = A[n] * x[n] + Bc[n] * y1 + C[n] * y2; y2 = y1; y1 = v; y[n] = v
    return y

def glottal(f0, open_q=0.6):
    """Rosenberg pulses (derivative, i.e. with lip radiation) along an f0 contour, 1% jitter"""
    out = np.zeros(len(f0)); phase = 0.0; jit = 1.0
    cyc = np.zeros(len(f0))
    for n in range(len(f0)):
        if f0[n] <= 0: phase = 0; continue
        phase += f0[n] * jit / SR
        if phase >= 1: phase -= 1; jit = 1 + rng.normal(0, 0.01)
        p = phase
        tp = open_q * 0.66; tn = open_q * 0.34
        g = 0.5 * (1 - np.cos(np.pi * p / tp)) if p < tp else (np.cos(np.pi * (p - tp) / (2 * tn)) if p < tp + tn else 0.0)
        out[n] = g; cyc[n] = p
    d = np.diff(out, prepend=0) * SR / 400
    return d, cyc

def voice(dur, f0pts, avpts, ahpts, forms, bws, burst=None, fric=None):
    t = np.arange(int(dur * SR)) / SR
    f0 = interp(t, f0pts) * (1 + 0.006 * np.sin(2 * np.pi * 5.2 * t))
    src, cyc = glottal(f0)
    av = interp(t, avpts) * (1 + rng.normal(0, 0.04, len(t)).cumsum() * 0)  # (shimmer below)
    shimmer = 1 + 0.05 * ss.lfilter([1], [1, -0.995], rng.normal(0, 0.02, len(t)))
    noise = rng.normal(0, 1, len(t))
    # breath noise pulsed with the glottal opening, plus steady aspiration
    ah = interp(t, ahpts)
    asp = noise * ah * (0.6 + 0.4 * (cyc < 0.5))
    exc = src * av * shimmer + asp * 0.5
    # spectral tilt of a relaxed male voice
    exc = ss.lfilter([1], [1, -0.4], exc)
    y = exc
    for F, B in zip(forms, bws):
        y = resonate(y, interp(t, F), interp(t, B))
    if burst is not None:
        # the ㅋ release: a short noise burst through a palatal-velar resonance, then frication fading
        bt0, bdur, bf = burst
        env = np.where((t >= bt0) & (t < bt0 + bdur), np.exp(-(t - bt0) / (bdur / 3)), 0)
        b = resonate(noise * env * 3.0, np.full(len(t), bf), np.full(len(t), 700.0))
        b += resonate(noise * env * 1.2, np.full(len(t), bf * 1.6), np.full(len(t), 1200.0))
        y = y + b
    y = ss.sosfilt(ss.butter(2, 70, "hp", fs=SR, output="sos"), y)
    y = ss.sosfilt(ss.butter(4, 9000, "lp", fs=SR, output="sos"), y)
    return y

def kya(length=1.0, peak=168, end=92, breath=0.55, seed=0):
    global rng; rng = np.random.default_rng(seed)
    L = length; on = 0.075  # voicing onset after the aspirated ㅋ
    glide = on + 0.085
    f0 = [(0, 0), (on - 0.001, 0), (on, peak * 0.93), (on + 0.06, peak), (glide + 0.12, peak * 0.96), (L * 0.62, peak * 0.74), (L * 0.85, end), (L, end * 0.9)]
    av = [(0, 0), (on, 0), (on + 0.02, 0.85), (glide + 0.05, 1.0), (L * 0.5, 0.8), (L * 0.72, 0.38), (L * 0.84, 0.06), (L, 0)]
    ah = [(0, 0), (0.012, 0.9), (on, 0.55), (on + 0.03, 0.12), (L * 0.45, 0.16), (L * 0.7, breath * 0.8), (L * 0.86, breath), (L, 0)]
    F1 = [(0, 320), (on, 300), (glide, 760), (L * 0.7, 720), (L, 650)]
    F2 = [(0, 2300), (on, 2250), (glide, 1220), (L * 0.7, 1120), (L, 1150)]
    F3 = [(0, 2950), (on, 2900), (glide, 2550), (L, 2480)]
    F4 = [(0, 3500), (L, 3400)]
    F5 = [(0, 4400), (L, 4300)]
    B1 = [(0, 200), (on, 120), (glide, 80), (L * 0.6, 90), (L, 260)]
    B2 = [(0, 250), (on, 140), (glide, 90), (L * 0.6, 110), (L, 300)]
    B3 = [(0, 300), (L, 260)]; B4 = [(0, 300), (L, 320)]; B5 = [(0, 400), (L, 450)]
    return voice(L, f0, av, ah, [F1, F2, F3, F4, F5], [B1, B2, B3, B4, B5], burst=(0.0, 0.018, 2700))

def hum(length=0.9, seed=3):
    """'음~': a closed-mouth hum, rising then falling (satisfied), nasal formants"""
    global rng; rng = np.random.default_rng(seed)
    L = length
    f0 = [(0, 112), (0.12, 122), (0.35, 150), (0.55, 138), (L, 96)]
    av = [(0, 0), (0.04, 0.7), (0.3, 1.0), (L * 0.75, 0.6), (L, 0)]
    ah = [(0, 0.05), (L * 0.8, 0.12), (L, 0)]
    F = [[(0, 260), (L, 260)], [(0, 1050), (L, 1000)], [(0, 2250), (L, 2200)], [(0, 3300), (L, 3300)]]
    B = [[(0, 70), (L, 90)], [(0, 300), (L, 300)], [(0, 300), (L, 350)], [(0, 400), (L, 400)]]
    y = voice(L, f0, av, ah, F, B)
    # (the nasal antiresonance: a notch near 1.4 kHz)
    b, a = ss.iirnotch(1400, 2, SR); return ss.lfilter(b, a, y)

def save(name, y, out):
    # (a small room's early reflections, so the voice is not bone dry)
    ir = np.zeros(int(0.12 * SR)); ir[0] = 1
    for d, g in ((0.011, .22), (0.019, .15), (0.031, .1), (0.047, .06), (0.071, .035)): ir[int(d * SR)] += g
    y = ss.fftconvolve(y, ir)[:len(y) + int(0.08 * SR)]
    y = y / (np.max(np.abs(y)) + 1e-9) * 0.88
    f = int(0.004 * SR); y[:f] *= np.linspace(0, 1, f); g = int(0.05 * SR); y[-g:] *= np.linspace(1, 0, g)
    wav.write(os.path.join(out, name + ".wav"), SR, (y * 32767).astype(np.int16))
    print(name, round(len(y) / SR, 2), "s")

out = sys.argv[1]
save("kya1", kya(0.95, 165, 94, 0.55, 1), out)
save("kya2", np.concatenate([kya(1.25, 150, 86, 0.7, 2)]), out)
save("kya3", kya(0.8, 178, 100, 0.45, 3), out)
save("mm", hum(0.95), out)
