"""Builds harness inputs from real bridge traces: per-frame bridge-stdout times and
which frames are speech (peak > 16) versus near-silence. Content is replaced by a
synthetic tone in the browser, so no recorded voice enters the harness output."""
import array, json, random, sys
import os
RUNS = os.environ.get("RUNS", "runs")  # probe traces: <tag>.json, <tag>.pcm, <tag>.trace.jsonl
out = {}

def frames_from(tag):
    R = json.load(open(f"{RUNS}/{tag}.json")); pcm = array.array("h", open(f"{RUNS}/{tag}.pcm", "rb").read())
    # Every decoded frame from the helper trace, in order; all-zero frames were
    # never sent by the old bridge, the others are matched to their stdout time.
    tr = [json.loads(l) for l in open(f"{RUNS}/{tag}.trace.jsonl")]
    fr = [e for e in tr if e["k"] == "fr"]
    sent = [e for e in R["log"] if e["type"] == "audio"]
    t0 = None; off = 0; frames = []; k = 0; lag = 0.0
    started = False
    for e in fr:
        if not e["z"]:
            s_ = sent[k]; k += 1
            f = pcm[off:off + s_["n"]]; off += s_["n"]
            if t0 is None: t0 = s_["t"]
            lag = s_["t"] - e["t"]; started = True
            frames.append({"t": round(s_["t"] - t0, 4), "n": s_["n"], "s": max(abs(x) for x in f) > 16})
        elif started:
            frames.append({"t": round(e["t"] + lag - t0, 4), "n": e["n"], "s": False, "z": True})
    assert k == len(sent), (k, len(sent))
    events = {}
    m = R["marks"]
    first_user = next((e["t"] for e in R["log"] if e["type"] == "session.input_transcript.delta" and e["t"] > m["b_start"]), None)
    return frames, t0, m, first_user

for tag in ["s01_v025_cove_b0", "s02_v025_ember_b0", "s02_v025_juniper_b0", "s22_v025_cove_b1"]:
    frames, t0, m, first_user = frames_from(tag)
    # Cut each real trace before the barge-in (the barge-in case is separate).
    cut = m["b_start"] - t0
    out["real_" + tag.split("_")[0] + "_" + tag.split("_")[2]] = {"frames": [f for f in frames if f["t"] < cut]}

# Barge-in: s01 from 3 s before the barge-in to the end; INTERRUPTION when the
# caller's first transcript reached the server.
frames, t0, m, first_user = frames_from("s01_v025_cove_b0")
start = m["b_start"] - t0 - 3
bf = [dict(f, t=round(f["t"] - start, 4)) for f in frames if f["t"] >= start]
out["bargein_s01"] = {"frames": bf, "bargeStart": round(m["b_start"] - t0 - start, 4), "interruptAt": round(first_user - t0 - start, 4)}

# Continuous speech: 60 s of real-time frames, spurts of 2-4 s and pauses of
# 0.2-0.6 s, with the bridge's own stdout jitter taken from s01.
frames, *_ = frames_from("s01_v025_cove_b0")
base = [f["t"] - i * 0.02 for i, f in enumerate(frames)]
lo = min(base); jit = [b - lo for b in base]
rnd = random.Random(1)
cf = []; i = 0; t = 0.0
while t < 60:
    for _ in range(int(rnd.uniform(2, 4) / 0.02)):
        cf.append({"t": round(i * 0.02 + jit[i % len(jit)], 4), "n": 480, "s": True}); i += 1
    for _ in range(int(rnd.uniform(0.2, 0.6) / 0.02)):
        cf.append({"t": round(i * 0.02 + jit[i % len(jit)], 4), "n": 480, "s": False}); i += 1
    t = i * 0.02
# keep stdout order
last = 0
for f in cf:
    last = max(last, f["t"]); f["t"] = last
out["continuous60"] = {"frames": cf}
# Same, but every pause is digital silence, which the old bridge drops (s21/s22 show such runs).
out["continuous60z"] = {"frames": [dict(f, z=True) if not f["s"] else f for f in cf]}
json.dump(out, open(os.path.join(os.path.dirname(__file__), "scenarios.json"), "w"))
for k, v in out.items():
    fr = v["frames"]; print(k, len(fr), "frames", round(fr[-1]["t"], 1), "s", "speech", sum(f["s"] for f in fr), "zero", sum(1 for f in fr if f.get("z")))
