"""Offline uplink comparison: v0.2.4/v0.2.5 mic queue vs the bounded Uplink, identical arrivals."""
import array, importlib.util, random, statistics, json
from pathlib import Path
spec = importlib.util.spec_from_file_location("cv", Path(__file__).resolve().parents[1] / "codex_voice.py")
cv = importlib.util.module_from_spec(spec); spec.loader.exec_module(cv)

class Old:
    """codex_voice.py up to v0.2.5: 1 s cap, 960 bytes per 20 ms, zero padding."""
    def __init__(self): self.buf = bytearray(); self.holes = 0
    def push(self, pcm):
        self.buf.extend(pcm)
        if len(self.buf) > 48000: del self.buf[:-48000]
    def pull(self):
        c = bytes(self.buf[:960]); del self.buf[:960]
        if len(c) < 960 and any(self.buf) or (0 < len(c) < 960): self.holes += 1
        return c.ljust(960, b"\0")

CH = 1024  # samples per browser chunk
def chunk(i):
    a = array.array("h", [5000] * CH); a[0] = -(i % 30000) - 1  # tag: negative index marker
    return a.tobytes()

def arrivals(kind, seed, n=700):
    rnd = random.Random(seed); out = []; last = 0
    for i in range(n):
        t = i * CH / 24  # ms
        d = rnd.uniform(0, 80 if kind == "jitter80" else 30)  # browser main-thread + network jitter
        if kind == "stall300" and 200 <= i < 207: d += (207 - i) * CH / 24
        if kind == "stall1000" and i == 200: d += 1000
        if kind == "resume" and 200 <= i < 224: d += (224 - i) * CH / 24 + 300  # 24 chunks queued by CallTransport, flushed on RESUMED
        last = max(last, t + d); out.append((last, i))
    return out

def run(cls, arr):
    up = cls(); e = 0; lat = []; holes_in_speech = 0
    for pull in range(int(arr[-1][0] / 20) + 50):
        t = pull * 20
        while e < len(arr) and arr[e][0] <= t:
            up.push(chunk(arr[e][1])); e += 1
        f = array.array("h", up.pull())
        for k, v in enumerate(f):
            if v < 0:
                lat.append((t, t + k / 24 - (-v - 1) * CH / 24))
        if e < len(arr) and t > 200 and f.count(0) >= 48: holes_in_speech += 1  # >= 2 ms of padding
    return lat, holes_in_speech

rows = []
for kind in ["steady", "jitter80", "stall300", "stall1000", "resume"]:
    for name, cls in [("v0.2.5", Old), ("new", cv.Uplink)]:
        res = []
        for seed in range(5):
            lat, holes = run(cls, arrivals(kind, seed))
            after = [l for t, l in lat if t > 200 * CH / 24 + 1500]  # from ~1.5 s after the event
            res.append((statistics.median(after), max(after), holes))
        rows.append(dict(case=kind, variant=name,
            latency_after_ms=f"{statistics.median(r[0] for r in res):.0f} [{min(r[0] for r in res):.0f}-{max(r[0] for r in res):.0f}]",
            max_after_ms=f"{max(r[1] for r in res):.0f}",
            silent_frames_while_speaking=f"{statistics.median(r[2] for r in res):.0f} [{min(r[2] for r in res)}-{max(r[2] for r in res)}]"))
for r in rows: print(json.dumps(r))
