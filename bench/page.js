// Offline playback harness: drives a Player variant in an OfflineAudioContext,
// delivering messages at simulated arrival times, and analyses what was rendered.
const RATE = 24000;
const Q = 128;

function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function b64(int16) {
  const bytes = new Uint8Array(int16.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const AMPS = [0.15, 0.3, 0.45];

/**
 * Turns bridge frames into browser messages for one protocol.
 * old: every frame that is not all-zero, no pts (v0.2.4/v0.2.5 bridge).
 * new: speech frames with pts, one empty marker when silence starts (fixed bridge).
 * Each spurt (run of speech frames) gets its own tone amplitude, cycling, so
 * gaps inside a spurt can be told from pauses between spurts.
 */
function messages(frames, protocol) {
  const out = [];
  let pts = 0, spurt = -1, silent = true;
  frames.forEach((f, i) => {
    if (f.s && silent) spurt++;
    const msg = { i, t: f.t, n: f.n, pts, amp: f.s ? AMPS[spurt % 3] : 0, spurt: f.s ? spurt : -1 };
    if (protocol === "old") { if (!f.z) out.push({ ...msg, k: "a" }); }
    else if (f.s) out.push({ ...msg, k: "a" });
    else if (!silent) out.push({ ...msg, k: "m" });
    silent = !f.s;
    pts += f.n;
  });
  return out;
}

function content(msg) {
  const pcm = new Int16Array(msg.n);
  for (let j = 0; j < msg.n; j++) {
    pcm[j] = msg.amp ? Math.round(msg.amp * 32767 * Math.sin((2 * Math.PI * 440 * (msg.pts + j)) / RATE)) : (j % 2 ? 1 : -1);
  }
  return pcm;
}

/** Network + browser delivery: iid uniform extra delay, ordered like a WebSocket, plus an optional stall. */
function deliver(msgs, { jitter = 0, seed = 1, stallAt = -1, stall = 0, base = 0.03, spikeP = 0, spikeMin = 0, spikeMax = 0 }) {
  const rnd = prng(seed);
  const delays = new Map();
  let last = 0;
  return msgs.map((m) => {
    if (!delays.has(m.i)) {
      const a = rnd(), b = rnd(), c = rnd();
      delays.set(m.i, a * jitter + (b < spikeP ? spikeMin + c * (spikeMax - spikeMin) : 0));
    }
    let at = m.t + base + delays.get(m.i);
    if (stall && m.t >= stallAt && m.t < stallAt + stall) at = Math.max(at, stallAt + stall + base);
    last = Math.max(last, at);
    return { ...m, at: last };
  });
}

async function runCase({ variant, frames, protocol, net, interruptAt = -1, bargeStart = -1, echo = 0, echoDelayTicks = 2, tail = 2 }) {
  let msgs = messages(frames, protocol);
  if (interruptAt >= 0) {
    // INTERRUPTION shares the socket with audio: insert by server time.
    const idx = msgs.findIndex((m) => m.t > interruptAt);
    msgs.splice(idx < 0 ? msgs.length : idx, 0, { k: "i", t: interruptAt, i: -1 });
  }
  msgs = deliver(msgs, net);
  const duration = Math.max(...msgs.map((m) => m.at)) + tail;
  const ctx = new OfflineAudioContext(1, Math.ceil(duration * RATE), RATE);
  window.AudioContext = function () { return ctx; };
  const lib = { v024: window.V024, v025: window.V025, new: window.VNEW }[variant];
  const player = variant === "new" ? new lib.Player(RATE, ctx) : new lib.Player(RATE);
  let engine = "nodes";
  if (variant === "new") engine = await player.ready;
  // Tap what reaches the speaker (after any ducking gain).
  const tap = ctx.createAnalyser();
  tap.fftSize = 1024;
  const out = player.gain ?? player.analyser;
  if (out) out.connect(tap);
  const ducks = [];
  if (player.gain) {
    const g = player.gain.gain;
    const orig = g.setTargetAtTime.bind(g);
    g.setTargetAtTime = (v, t, c) => { ducks.push([t, v]); return orig(v, t, c); };
  }
  // Group messages per render quantum.
  const byQ = new Map();
  for (const m of msgs) {
    const q = Math.ceil((m.at * RATE) / Q);
    if (!byQ.has(q)) byQ.set(q, []);
    byQ.get(q).push(m);
  }
  // Mic ticks every 1024 samples for the echo test.
  const tickQ = 1024 / Q;
  const totalQ = Math.floor((duration * RATE) / Q) - 1;
  if (echo) for (let q = tickQ; q < totalQ; q += tickQ) if (!byQ.has(q)) byQ.set(q, []);
  const hist = [];
  let intDelivered = -1;
  const buf = new Float32Array(1024);
  for (const [q, list] of byQ) {
    if (q <= 0 || q >= totalQ) continue;
    ctx.suspend((q * Q) / RATE).then(async () => {
      for (const m of list) {
        if (m.k === "i") { player.interrupt(); intDelivered = ctx.currentTime; continue; }
        const data = m.k === "m" ? "" : b64(content(m));
        if (protocol === "new") player.enqueue(data, m.pts);
        else player.enqueue(data);
      }
      if (echo && q % tickQ === 0) {
        tap.getFloatTimeDomainData(buf);
        let e = 0;
        for (const x of buf) e += x * x;
        hist.push(Math.sqrt(e / buf.length));
        const k = hist.length - 1 - echoDelayTicks;
        const rms = k >= 0 ? echo * hist[k] : 0;
        player.micLevel?.(rms, false);
      }
      if (variant === "new") await player.stats();
      ctx.resume();
    });
  }
  const t0 = performance.now();
  const rendered = (await ctx.startRendering()).getChannelData(0);
  const stats = variant === "new" ? await player.stats() : null;
  const res = analyse(rendered, msgs);
  res.engine = engine;
  res.stats = stats;
  res.wallMs = Math.round(performance.now() - t0);
  res.ducks = ducks.filter(([, v]) => v < 0.5).length;
  let duckedS = 0;
  for (let i = 0; i < ducks.length; i++) if (ducks[i][1] < 0.5) duckedS += ((ducks[i + 1]?.[0] ?? duration) - ducks[i][0]);
  res.duckedS = +duckedS.toFixed(3);
  if (interruptAt >= 0) {
    // Local cut: from INTERRUPTION delivery to the first 20 ms of silence.
    const from = Math.round(intDelivered * RATE);
    res.cutMs = silentAfter(rendered, from, 0.02);
    // Barge-in start to sustained (300 ms) silence.
    const b = Math.round(bargeStart * RATE);
    res.bargeToSilenceS = +(silentAfter(rendered, b, 0.3) / 1000 + 0).toFixed(3);
    res.interruptDeliveredS = +(intDelivered - bargeStart).toFixed(3);
    // Assistant audio heard during the 5 s after the barge-in starts.
    let last = -1, heard = 0;
    for (let i = b; i < Math.min(rendered.length, b + 5 * RATE); i++) if (Math.abs(rendered[i]) >= 1e-3) { last = i; heard++; }
    res.lastAudibleAfterBargeS = last < 0 ? 0 : +((last - b) / RATE).toFixed(3);
    res.heardAfterBargeS = +(heard / RATE).toFixed(3);
  }
  return res;
}

/** ms from `from` until the output is silent for `holdS` seconds. */
function silentAfter(x, from, holdS) {
  const hold = holdS * RATE;
  let run = 0;
  for (let i = Math.max(0, from); i < x.length; i++) {
    if (Math.abs(x[i]) < 1e-3) { if (++run >= hold) return +(((i - run + 1 - from) / RATE) * 1000).toFixed(1); }
    else run = 0;
  }
  return null;
}

function analyse(x, msgs) {
  // Audible regions (|x| >= 1e-3), merging runs of silence shorter than 2.5 ms
  // (zero crossings, fades).
  const regions = [];
  let start = -1, lastLoud = -1, peak = 0;
  const minGap = Math.round(0.0025 * RATE);
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a >= 1e-3) {
      if (start < 0) { start = i; peak = 0; }
      else if (i - lastLoud > minGap) { regions.push({ start, end: lastLoud + 1, peak }); start = i; peak = 0; }
      lastLoud = i;
      if (a > peak) peak = a;
    }
  }
  if (start >= 0) regions.push({ start, end: lastLoud + 1, peak });
  // Identify each region's spurt by its tone amplitude (ducking scales it, so
  // compare against the nearest of the three levels or a tenth of them).
  const code = (p) => {
    let best = -1, err = Infinity;
    AMPS.forEach((a, k) => { for (const s of [1, 0.1]) { const e = Math.abs(p - a * s); if (e < err) { err = e; best = k; } } });
    return best;
  };
  const gaps = [];
  for (let r = 1; r < regions.length; r++) {
    if (code(regions[r].peak) === code(regions[r - 1].peak)) gaps.push((regions[r].start - regions[r - 1].end) / RATE);
  }
  // Spurt latency: output start of each spurt vs the bridge time of its first frame.
  const firstOf = new Map();
  for (const m of msgs) if (m.k === "a" && m.spurt >= 0 && !firstOf.has(m.spurt)) firstOf.set(m.spurt, m.t);
  const spurtStarts = [];
  let prevCode = -1;
  for (const r of regions) {
    const c = code(r.peak);
    if (c !== prevCode) spurtStarts.push(r.start / RATE);
    prevCode = c;
  }
  const lat = [];
  const firsts = [...firstOf.values()];
  for (let k = 0; k < Math.min(firsts.length, spurtStarts.length); k++) lat.push(spurtStarts[k] - firsts[k]);
  const audible = regions.reduce((n, r) => n + r.end - r.start, 0) / RATE;
  const speech = msgs.filter((m) => m.k === "a" && m.amp).reduce((n, m) => n + m.n, 0) / RATE;
  // Delay at the end: when the last speech sample played vs when the bridge sent it.
  const lastMsg = [...msgs].reverse().find((m) => m.k === "a" && m.amp);
  const endDelay = regions.length ? regions.at(-1).end / RATE - (lastMsg.t + lastMsg.n / RATE) : null;
  return {
    gaps: gaps.length, gapS: +gaps.reduce((a, b) => a + b, 0).toFixed(3), gapMaxMs: gaps.length ? Math.round(Math.max(...gaps) * 1000) : 0,
    speechS: +speech.toFixed(2), audibleS: +audible.toFixed(2),
    firstLatencyMs: lat.length ? Math.round(lat[0] * 1000) : null,
    medianSpurtLatencyMs: lat.length ? Math.round(lat.sort((a, b) => a - b)[lat.length >> 1] * 1000) : null,
    endDelayMs: endDelay === null ? null : Math.round(endDelay * 1000),
    spurtsSeen: spurtStarts.length, spurtsSent: firstOf.size,
  };
}

window.runCase = runCase;
window.harnessReady = true;
