import { afterEach, expect, it, vi } from "vitest";
import { Player } from "../audio";

afterEach(() => vi.unstubAllGlobals());

it("plays through a 100 ms late packet and discards queued sound on interrupt", () => {
  let now = 0;
  const starts: number[] = [];
  const stop = vi.fn();
  class Context {
    sampleRate = 24000;
    get currentTime() { return now; }
    createGain() { return { connect() {}, gain: { setTargetAtTime() {} } }; }
    createAnalyser() { return { connect() {} }; }
    createBuffer(_channels: number, frames: number, rate: number) {
      return { copyToChannel() {}, duration: frames / rate };
    }
    createBufferSource() { return { connect() {}, start: (at: number) => starts.push(at), stop }; }
  }
  vi.stubGlobal("AudioContext", Context);
  const player = new Player(24000);
  const chunk = Buffer.alloc(960).toString("base64"); // 20 ms
  player.enqueue(chunk);
  now = 0.12;
  player.enqueue(chunk);
  expect(starts[1] - starts[0]).toBeCloseTo(0.02);
  player.interrupt();
  expect(stop).toHaveBeenCalledTimes(2);
  now = 1;
  player.enqueue(chunk);
  expect(starts[2]).toBeCloseTo(1.14);
});
