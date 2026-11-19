// Audio plumbing for Voice Mode: PCM16 <-> base64, gapless playback with
// instant interrupt, and mic capture at the session's input rate.

function base64FromInt16(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function float32FromBase64Pcm16(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
  return out;
}

/** Plays 24 kHz PCM chunks back to back and can drop everything queued. */
export class Player {
  private readonly ctx: AudioContext;
  private playhead = 0;
  private speechChunks = 0;
  private quietChunks = 0;
  private ducked = false;
  private readonly gain: GainNode;
  private readonly sources = new Set<AudioBufferSourceNode>();
  onIdle: (() => void) | null = null;

  constructor(sampleRate: number) {
    this.ctx = new AudioContext({ sampleRate });
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.gain = this.ctx.createGain();
    this.analyser.connect(this.gain);
    this.gain.connect(this.ctx.destination);
  }

  private readonly analyser: AnalyserNode;
  private readonly frame = new Float32Array(512);

  /** RMS of what is audible right now, 0..1. */
  level(): number {
    if (!this.playing) return 0;
    this.analyser.getFloatTimeDomainData(this.frame);
    let energy = 0;
    for (const s of this.frame) energy += s * s;
    return Math.sqrt(energy / this.frame.length);
  }

  get playing(): boolean {
    return this.sources.size > 0;
  }

  micLevel(rms: number, muted: boolean) {
    // Briefly lower playback under sustained near-end speech. The server
    // remains responsible for cancelling the response and clearing its queue.
    const speech = !muted && this.playing && rms > Math.max(0.04, this.level() * 0.5);
    this.speechChunks = speech ? this.speechChunks + 1 : 0;
    this.quietChunks = speech ? 0 : this.quietChunks + 1;
    const duck = !muted && this.playing && (this.ducked ? this.quietChunks < 4 : this.speechChunks >= 2);
    if (duck !== this.ducked) {
      this.ducked = duck;
      this.gain.gain.setTargetAtTime(duck ? 0.1 : 1, this.ctx.currentTime, duck ? 0.01 : 0.03);
    }
  }

  enqueue(base64: string) {
    const samples = float32FromBase64Pcm16(base64);
    if (samples.length === 0) return;
    const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    // Keep a small reserve across uneven packet arrivals. Refill only after an underrun.
    const now = this.ctx.currentTime;
    const shortUnderrun = this.playhead > 0 && now - this.playhead < 0.35;
    const startAt = this.playhead > now ? this.playhead : now + (shortUnderrun ? 0.04 : 0.14);
    source.start(startAt);
    this.playhead = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) this.onIdle?.();
    };
  }

  interrupt() {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.sources.clear();
    this.playhead = 0;
    this.micLevel(0, true);
    this.onIdle?.();
  }

  async close() {
    this.interrupt();
    await this.ctx.close().catch(() => undefined);
  }
}

// Local barge-in: the proxy can only interrupt audio it is still generating,
// and it sends audio faster than real time. If the user talks over audio we
// already buffered, cut playback here. 5 chunks (~213 ms at 24 kHz) above this
// RMS count as speech;
// echo cancellation keeps the model's own voice well below it.
export const BARGE_IN_RMS = 0.04;
export const BARGE_IN_CHUNKS = 5;

/** Captures the mic at the session's input rate as PCM16 chunks. */
// While muted the mic keeps running but sends digital silence, so the session
// stays open and the server VAD still sees the end of any cut-off utterance.
export async function startMic(sampleRate: number, isMuted: () => boolean, onChunk: (base64: string, rms: number) => void) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext({ sampleRate });
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor avoids loading a worklet module under bb's CSP; 1024
  // frames at 24 kHz is a ~43 ms chunk.
  const processor = ctx.createScriptProcessor(1024, 1, 1);
  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const pcm = new Int16Array(input.length);
    if (isMuted()) {
      onChunk(base64FromInt16(pcm), 0);
      return;
    }
    let energy = 0;
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      energy += s * s;
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    onChunk(base64FromInt16(pcm), Math.sqrt(energy / input.length));
  };
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(processor);
  processor.connect(sink);
  sink.connect(ctx.destination);
  return async () => {
    processor.onaudioprocess = null;
    stream.getTracks().forEach((track) => track.stop());
    await ctx.close().catch(() => undefined);
  };
}

