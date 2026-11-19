import { afterEach, expect, it, vi } from "vitest";
import { CallTransport } from "../call-transport";

class Socket {
  static OPEN = 1;
  static all: Socket[] = [];
  readyState = 1;
  send = vi.fn();
  close = vi.fn();
  onopen?: () => void;
  onclose?: (event: { code: number }) => void;
  onmessage?: (event: { data: string }) => void;
  constructor(readonly url: URL) { Socket.all.push(this); }
  receive(frame: unknown) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); Socket.all = []; });

it("resumes with the last sequence, preserves mic frames, and cancels retries on hangup", () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", Socket);
  const receive = vi.fn();
  const failed = vi.fn();
  const call = new CallTransport("wss://example.test/session?threadId=1", receive, failed);
  const first = Socket.all[0];
  first.onopen?.();
  first.receive({ type: "RESUME_TOKEN", token: "test" });
  first.receive({ seq: 1, event: { type: "READY" } });
  first.onclose?.({ code: 1006 });
  call.send({ type: "AUDIO", base64Data: "AAAA" });
  vi.advanceTimersByTime(140);
  const next = Socket.all[1];
  next.onopen?.();
  expect(JSON.parse(next.send.mock.calls[0][0])).toEqual({ token: "test", after: 1 });
  next.receive({ type: "RESUMED" });
  expect(JSON.parse(next.send.mock.calls[1][0])).toEqual({ type: "AUDIO", base64Data: "AAAA" });
  next.receive({ seq: 1, event: { type: "READY" } });
  next.receive({ seq: 2, event: { type: "AUDIO" } });
  expect(receive.mock.calls.map(([e]) => e.type)).toEqual(["READY", "AUDIO"]);
  next.onclose?.({ code: 1006 });
  call.close();
  vi.advanceTimersByTime(10000);
  expect(Socket.all).toHaveLength(2);
  expect(failed).not.toHaveBeenCalled();
});
