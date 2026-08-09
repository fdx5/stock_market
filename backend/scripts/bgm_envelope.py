"""Turns a track into the envelope the entrance page's equaliser reads.

Run once per song, offline. The output is a small JSON file that ships with the
frontend; nothing about this runs on the server or in a request.

    python backend/scripts/bgm_envelope.py <audio-file> <youtube-video-id>

    python backend/scripts/bgm_envelope.py "D:/mix/breath.wav" 8PqN8kexaT0
        -> frontend/public/bgm/8PqN8kexaT0.json

WHY THIS EXISTS
    The page plays its music through a YouTube iframe, and the audio inside a
    cross-origin iframe cannot be reached by the Web Audio API — there is no
    element to hand to createMediaElementSource and no way to get one. So a
    live spectrum is not available at any price short of asking every visitor
    for screen-share permission.

    What IS available is the playback position (`player.getCurrentTime()`).
    So the analysis happens here, once, and the page reads the answer at the
    right moment. The bars move with the actual music — the same peaks, the
    same quiet passages — they are simply not computed while you listen.

FORMAT
    One character per band per frame, base36. A bar thirteen pixels tall has
    nothing to do with more than 36 levels, and one character per value keeps a
    three-minute track around 50 kB raw and a third of that over the wire —
    which is the whole point of doing it this way rather than serving audio.

    {"fps": 20, "bands": 14, "duration": 183.4, "data": "9a3f…"}

    Frame i is data[i*bands : (i+1)*bands]; each character is int(c, 36) / 35.

AUDIO FORMATS
    WAV needs nothing installed — the standard library reads it.

    Everything else (mp4, m4a, mp3, flac…) goes through ffmpeg, taken from the
    `imageio-ffmpeg` package rather than from the system. That package ships
    the binary inside the wheel, so it lands in the virtualenv, changes no PATH
    and installs nothing machine-wide:

        pip install imageio-ffmpeg

    A system ffmpeg on PATH is used if there is one. This is a development-only
    tool — deliberately not in requirements.txt, because the server neither
    runs it nor needs it.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

# Frames a second. Twenty is well past what the eye resolves in a bar chart
# this size, and the runtime smooths between frames anyway — going higher buys
# nothing visible and costs file size in direct proportion.
FPS = 20
# Matches EQ_BARS in HubType2.tsx. If one changes, so must the other.
BANDS = 14
# The window each frame is measured over. Long enough for the low bands to have
# something to measure (a 40 Hz wave is 25 ms of air) and short enough that a
# drum hit does not smear across half a second.
WINDOW = 2048
# Base36: '0'-'9' then 'a'-'z', so 36 levels in one character.
LEVELS = 36
# How far below the peak counts as silence. See the normalisation in analyse()
# for why this is bounded rather than taken from the track's own minimum.
RANGE_DB = 55.0
# The span the bands are laid across, and the display tilt applied over it.
# See the note in analyse() for why the tilt exists.
LOW_HZ = 40.0
HIGH_HZ = 14000.0
TILT_DB_PER_OCTAVE = 3.5

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = REPO_ROOT / "frontend" / "public" / "bgm"


def find_ffmpeg() -> str | None:
    """The system's, or the one imageio-ffmpeg carries in the virtualenv."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg  # type: ignore

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def load_audio(path: Path) -> tuple[np.ndarray, int]:
    """Mono float samples in -1..1, and the sample rate."""
    if path.suffix.lower() == ".wav":
        return _load_wav(path)

    ffmpeg = find_ffmpeg()
    if not ffmpeg:
        raise SystemExit(
            f"{path.suffix} needs ffmpeg, which is not on PATH and not installed here.\n"
            "Either export the track as WAV (no install needed), or run:\n"
            "    pip install imageio-ffmpeg"
        )

    # Decoded straight to a pipe as 32-bit float mono: no temporary file, no
    # second lossy step, and -ac 1 does the channel mix in ffmpeg rather than
    # pulling twice the samples through Python to average them here.
    #
    # The rate is pinned rather than read back, because raw PCM carries no
    # header to read it from. 48k is a resample for a 44.1k source, which for
    # measuring loudness in fourteen bands changes nothing that can be seen.
    rate = 48000
    command = [
        ffmpeg,
        "-v", "error",
        "-i", str(path),
        # Fails loudly on a video file with no audio track rather than writing
        # an empty stream and leaving the caller to guess why.
        "-vn",
        "-f", "f32le",
        "-ac", "1",
        "-ar", str(rate),
        "-",
    ]
    result = subprocess.run(command, capture_output=True)
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", "replace").strip()
        raise SystemExit(f"ffmpeg could not decode {path.name}:\n{message}")

    samples = np.frombuffer(result.stdout, dtype="<f4").astype(np.float32)
    return samples, rate


def _load_wav(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wav:
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        rate = wav.getframerate()
        raw = wav.readframes(wav.getnframes())

    if width == 2:
        samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 4:
        # 32-bit WAV is either int or float depending on the exporter; the
        # format tag is not exposed by the wave module, so this guesses from
        # the values themselves. Float PCM sits inside -1..1; integer PCM does
        # not, by a factor of two billion.
        as_float = np.frombuffer(raw, dtype="<f4")
        if np.isfinite(as_float).all() and np.abs(as_float).max() <= 1.5:
            samples = as_float.astype(np.float32)
        else:
            samples = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    elif width == 3:
        # 24-bit has no numpy dtype: widen each sample to 32 bits, sign-extending
        # by putting the three bytes in the HIGH end and shifting back down.
        trip = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        widened = np.zeros((len(trip), 4), dtype=np.uint8)
        widened[:, 1:] = trip
        samples = (
            widened.view("<i4").reshape(-1).astype(np.float32) / 2147483648.0
        )
    elif width == 1:
        samples = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128.0
    else:
        raise SystemExit(f"unsupported WAV sample width: {width * 8}-bit")

    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, rate


def band_edges(rate: int) -> list[tuple[int, int]]:
    """Where each bar's slice of the spectrum starts and ends, in FFT bins.

    Logarithmic, because hearing is. Split linearly, the first bar would cover
    everything below 700 Hz — nearly all the energy in most music — and the top
    half of the bars would be air. Every bar should have a chance to move."""
    nyquist = rate / 2
    low, high = LOW_HZ, min(HIGH_HZ, nyquist * 0.95)
    edges = np.geomspace(low, high, BANDS + 1)
    bins = np.floor(edges / nyquist * (WINDOW // 2)).astype(int)
    out = []
    for i in range(BANDS):
        start = int(bins[i])
        # At least one bin each, or the lowest bands round to empty slices and
        # those bars never move at all.
        end = max(int(bins[i + 1]), start + 1)
        out.append((start, end))
    return out


def analyse(samples: np.ndarray, rate: int) -> tuple[str, float]:
    hop = max(1, rate // FPS)
    edges = band_edges(rate)
    window = np.hanning(WINDOW).astype(np.float32)
    frame_count = max(1, len(samples) // hop)

    levels = np.zeros((frame_count, BANDS), dtype=np.float32)
    for i in range(frame_count):
        start = i * hop
        chunk = samples[start : start + WINDOW]
        if len(chunk) < WINDOW:
            chunk = np.pad(chunk, (0, WINDOW - len(chunk)))
        power = np.abs(np.fft.rfft(chunk * window)) ** 2
        for b, (lo, hi) in enumerate(edges):
            # Energy in the band, not the average bin.
            #
            # The bands are logarithmic, so the top one spans hundreds of bins
            # and the bottom one spans two. Averaging divides by that width: a
            # single loud note high up gets spread across every bin in its band
            # and reads as almost nothing, while the same note low down fills
            # its band completely. A 9 kHz tone came out at half the height of
            # a 70 Hz one at identical amplitude. Summing the power measures
            # how much sound is in the band, which is the question, and does
            # not care how many bins it took to hold it.
            levels[i, b] = np.sqrt(power[lo:hi].sum())

    # To dB. Amplitude is what a meter measures, not what an ear hears: linear
    # magnitudes leave every bar flat against the floor except during the
    # loudest moments, because most of a track sits within a few percent of the
    # peak in linear terms and thirty decibels of it in perceptual ones.
    levels = 20.0 * np.log10(levels + 1e-9)

    # A tilt across the bands, the way a real analyser has one.
    #
    # Music loses energy as frequency rises — roughly a few decibels an octave,
    # for every instrument and every genre. Measured flat, the top bands are
    # always near the floor whatever is playing, and after normalisation they
    # sit at zero and never move: on a solo piano piece the top three bars were
    # dead for the whole track, which reads as three broken bars rather than as
    # a quiet treble.
    #
    # So each band is lifted in proportion to how far up the spectrum it sits.
    # This is a display curve, not a correction — it does not make the treble
    # louder than it was, it stops the bars being a chart of a fact everybody
    # already knows.
    octaves = np.log2(np.geomspace(1.0, HIGH_HZ / LOW_HZ, BANDS))
    levels = levels + (octaves * TILT_DB_PER_OCTAVE).astype(np.float32)

    # Normalised against the track's own range rather than an absolute scale,
    # so a quietly mastered song still fills the bars.
    #
    # The floor is held within RANGE_DB of the peak, and that bound is doing
    # real work rather than being a safety rail. Anchored to the track's own
    # quietest moment instead, a fade-out or a gap between sections drops the
    # floor to digital silence — and then the whole 180 dB from silence to peak
    # gets stretched across the bars, so the faint spectral leakage either side
    # of a note maps to something like sixty percent height. A pure bass tone
    # lit every bar on the board. Everything more than RANGE_DB below the peak
    # is off, which is what a meter does and what the eye expects.
    ceiling = float(np.percentile(levels, 99.5))
    floor = max(float(np.percentile(levels, 12)), ceiling - RANGE_DB)
    if ceiling - floor < 1e-6:
        ceiling = floor + 1.0
    norm = np.clip((levels - floor) / (ceiling - floor), 0.0, 1.0)

    # A gentle lift. Squared-off at the bottom the bars spend most of a track
    # flat; this pulls the middle up without touching either end.
    norm = norm ** 0.75

    quantised = np.round(norm * (LEVELS - 1)).astype(int)
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    data = "".join(alphabet[v] for v in quantised.reshape(-1))
    return data, len(samples) / rate


def main() -> None:
    if len(sys.argv) != 3:
        print(__doc__)
        raise SystemExit(2)

    source = Path(sys.argv[1])
    video_id = sys.argv[2]
    if not source.exists():
        raise SystemExit(f"no such file: {source}")

    samples, rate = load_audio(source)
    if samples.size == 0:
        raise SystemExit("that file decoded to no audio")

    print(f"{source.name}: {len(samples) / rate:.1f}s at {rate} Hz")
    data, duration = analyse(samples, rate)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out = OUT_DIR / f"{video_id}.json"
    payload = {
        "fps": FPS,
        "bands": BANDS,
        "duration": round(duration, 2),
        "data": data,
    }
    out.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {out.relative_to(REPO_ROOT)}  ({out.stat().st_size / 1024:.0f} kB raw)")


if __name__ == "__main__":
    main()
