// Offline playback benchmark: v0.2.4, v0.2.5 and the current Player on identical inputs.
//
//   bash bench/build.sh                 # bundles the three Player variants into bench/.build
//   CHROME=/path/to/chrome node bench/run.mjs [scenario-prefix|all] [cond,cond]
//   python3 bench/tables.py bench/results_all.json continuous60|continuous60z|real|echo|barge
//
// Each case renders in an OfflineAudioContext; messages are delivered at their
// simulated arrival times (bridge stdout time + network delay, ordered like a
// WebSocket). Content is a synthetic tone, one amplitude per talk spurt, so a
// silence inside a spurt is a gap and one between spurts is a pause.
// scenarios.json holds frame timings and speech/silence flags from probe calls
// with synthetic (espeak) prompts; no recorded audio.
import { launch } from "./cdp.mjs";
import { serve } from "./serve.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const sc = JSON.parse(readFileSync(new URL("./scenarios.json", import.meta.url)));
const srv = await serve(null);
const b = await launch();
await b.send("Page.navigate", { url: srv.url });
for (let i = 0; i < 50 && !(await b.evaluate("!!window.harnessReady")); i++) await new Promise(r => setTimeout(r, 100));
const VARIANTS = [["v024", "old"], ["v025", "old"], ["new", "new"]];
const firstSpeech = (fr) => fr.find(f => f.s).t;
const CONDS = (stallAt) => ({
  "j0": { jitter: 0 },
  "j30": { jitter: 0.03 },
  "j80": { jitter: 0.08 },
  "j150": { jitter: 0.15 },
  "spikyRare": { jitter: 0.03, spikeP: 0.002, spikeMin: 0.15, spikeMax: 0.4 },
  "spiky": { jitter: 0.03, spikeP: 0.01, spikeMin: 0.15, spikeMax: 0.4 },
  "stall300": { jitter: 0.03, stallAt, stall: 0.3 },
  "stall1000": { jitter: 0.03, stallAt, stall: 1.0 },
});
const results = [];
async function run(cfg) {
  const json = await b.evaluate(`runCase(${JSON.stringify(cfg)}).then(JSON.stringify)`);
  return JSON.parse(json);
}
const which = process.argv[2] ?? "all";
const only = process.argv[3] ? process.argv[3].split(",") : null;
const SEEDS = [1, 2, 3, 4, 5];
for (const name of Object.keys(sc)) {
  if (which !== "all" && !name.startsWith(which)) continue;
  const s = sc[name];
  const stallAt = name.startsWith("continuous60") ? 10 : name.startsWith("bargein") ? s.bargeStart - 1.5 : firstSpeech(s.frames) + 1.0;
  for (const [cond, net] of Object.entries(CONDS(stallAt))) {
    if (only && !only.includes(cond)) continue;
    for (const seed of (cond === "j0" ? [1] : SEEDS)) {
      for (const [variant, protocol] of VARIANTS) {
        const cfg = { variant, protocol, frames: s.frames, net: { ...net, seed } };
        if (s.interruptAt !== undefined) Object.assign(cfg, { interruptAt: s.interruptAt, bargeStart: s.bargeStart });
        const r = await run(cfg);
        results.push({ scenario: name, cond, seed, variant, ...r });
      }
    }
  }
  // Echo of the assistant's own voice in the mic (v0.2.5 ducking).
  if (!name.startsWith("bargein") && (!only || only.includes("echo"))) {
    for (const echo of [0.25, 0.5, 1.0]) for (const seed of [1, 2, 3]) for (const [variant, protocol] of VARIANTS) {
      const r = await run({ variant, protocol, frames: s.frames, net: { jitter: 0.03, seed }, echo });
      results.push({ scenario: name, cond: `echo${echo}`, seed, variant, ...r });
    }
  }
  console.error("done", name);
}
writeFileSync(new URL(`./results_${which}.json`, import.meta.url), JSON.stringify(results));
b.close(); srv.close();
