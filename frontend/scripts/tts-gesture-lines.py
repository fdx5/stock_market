"""The gestures' spoken lines, read by MeloTTS (Korean, MIT licence: github.com/myshell-ai/MeloTTS)
in a bright, quick delivery, into a cache of WAVs for make-gesture-sounds.py.
Run with a Python that has MeloTTS installed: python tts-gesture-lines.py <out_dir>"""
import os, sys, types, importlib.machinery
# (g2pkk wants a Korean MeCab — eunjeon on Windows, which needs a C++ build. These lines are short
# interjections: its part-of-speech hints only refine a few rules, so each word passes as a noun.)
_m = types.ModuleType("eunjeon"); _m.__spec__ = importlib.machinery.ModuleSpec("eunjeon", None)
class _Mecab:
    def pos(self, s): return [(w, "NNG") for w in s.split()]
_m.Mecab = _Mecab; sys.modules["eunjeon"] = _m
from melo.api import TTS

LINES = {
    "wave": "안녕~! 반가워요!", "bow": "안녕하세요!", "deepBow": "정말 감사합니다!", "nod": "응응, 좋아요!", "shake": "아니요, 아니에요~",
    "clap": "와아~ 멋져요!", "cheer": "만세! 신난다!", "point": "저기 있어요!", "shrug": "글쎄요~?", "salute": "충성!",
    "think": "음… 뭐였더라?", "phone": "여보세요~? 네, 지금 가요!", "lookPhone": "어? 메시지 왔다!", "watch": "어머, 벌써 시간이 이렇게!", "scratch": "헤헤, 깜빡했네요.",
    "crossArms": "흠, 그렇단 말이죠?", "handsHips": "좋아, 가 볼까요!", "stretch": "으아~ 시원하다!", "yawn": "하아암~ 졸려요.", "facepalm": "아이고, 이런…",
    "laugh": "하하하! 진짜 웃겨요!", "cry": "흑흑… 너무 슬퍼요.", "angry": "으으, 화났어요!", "thumbsUp": "최고예요!", "heart": "사랑해요~!",
    "peace": "브이~! 찰칵!", "dance": "같이 춤춰요!", "robot": "삐빅, 로봇 모드 작동!", "groove": "리듬을 타 봐요~!", "jump": "야호~!",
    "beckon": "이리 와요~!", "stop": "잠깐만요!", "lookAround": "어디지? 여기인가?", "kick": "얍!", "shy": "에헤헤… 부끄러워요.",
}
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
tts = TTS(language="KR", device="cpu")
spk = tts.hps.data.spk2id["KR"]
for name, text in LINES.items():
    tts.tts_to_file(text, spk, os.path.join(out, f"{name}.wav"), speed=1.12, quiet=True)
    print(name, text, flush=True)
