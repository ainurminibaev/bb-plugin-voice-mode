import json, statistics, collections, sys
R = json.load(open(sys.argv[1]))
V = ["v024", "v025", "new"]
def med(xs, fmt="{:.0f}"):
    xs = [x for x in xs if x is not None]
    if not xs: return "-"
    m = statistics.median(xs)
    return (fmt.format(m) + (f" ({fmt.format(min(xs))}-{fmt.format(max(xs))})" if min(xs) != max(xs) else ""))
g = collections.defaultdict(list)
for r in R:
    r["gpm"] = r["gaps"] / (r["speechS"] / 60); r["gmspm"] = r["gapS"] * 1000 / (r["speechS"] / 60)
    g[(r["scenario"], r["cond"], r["variant"])].append(r)
section = sys.argv[2]
if section in ("continuous60", "continuous60z"):
    print(f"{section}: gaps/min | gap ms/min | median spurt latency ms (median (min-max) over seeds)")
    for c in ["j0", "j30", "j80", "j150", "spikyRare", "spiky", "stall300", "stall1000"]:
        print(c.ljust(10), " || ".join(f"{v}: {med([r['gpm'] for r in g[(section,c,v)]], '{:.1f}')} | {med([r['gmspm'] for r in g[(section,c,v)]])} | {med([r['medianSpurtLatencyMs'] for r in g[(section,c,v)]])}" for v in V))
elif section == "real":
    print("real first-response traces (4 runs x seeds): client delay to first audible sample ms | gaps total")
    for c in ["j0", "j30", "j80", "j150", "spikyRare", "spiky", "stall300", "stall1000"]:
        print(c.ljust(10), " || ".join(f"{v}: {med([r['firstLatencyMs'] for k in g if k[0].startswith('real') and k[1]==c and k[2]==v for r in g[k]])} | {sum(r['gaps'] for k in g if k[0].startswith('real') and k[1]==c and k[2]==v for r in g[k])}" for v in V))
elif section == "echo":
    print("echo of own voice in mic (coupling g, delay ~85 ms), j30: duck events/min | ducked s/min | gaps")
    for sc in ["continuous60", "continuous60z", "real"]:
        for e in ["echo0.25", "echo0.5", "echo1"]:
            rows = {v: [r for k in g if (k[0] == sc or (sc == "real" and k[0].startswith("real"))) and k[1] == e and k[2] == v for r in g[k]] for v in V}
            print(sc.ljust(13), e.ljust(9), " || ".join(f"{v}: {med([r['ducks']/(r['speechS']/60) for r in rows[v]], '{:.1f}')} | {med([r['duckedS']/(r['speechS']/60) for r in rows[v]], '{:.1f}')} | {sum(r['gaps'] for r in rows[v])}" for v in V))
elif section == "barge":
    print("barge-in (s01 trace): INTERRUPTION delivered after barge start s | assistant audible s in 5 s after barge start | last audible s after barge start")
    for c in ["j0", "j30", "j80", "j150", "spiky", "stall300"]:
        print(c.ljust(10), " || ".join(f"{v}: {med([r['interruptDeliveredS'] for r in g[('bargein_s01',c,v)]], '{:.2f}')} | {med([r['heardAfterBargeS'] for r in g[('bargein_s01',c,v)]], '{:.2f}')} | {med([r['lastAudibleAfterBargeS'] for r in g[('bargein_s01',c,v)]], '{:.2f}')}" for v in V))
