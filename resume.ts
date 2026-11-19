import { randomUUID } from "node:crypto";
import type { ExperimentalPluginWebSocket as Socket, ExperimentalPluginWebSocketHandler as Handler } from "@get-bb/plugin-sdk";

const GRACE_MS = 8000;
const MAX_REPLAY_BYTES = 1024 * 1024;

export function resumableCalls(start: Handler): Handler {
  type Attach = (socket: Socket, after: number) => boolean;
  type Call = {
    thread: string;
    attach: Attach;
    receive(socket: Socket, data: string | Uint8Array): void;
    detach(socket: Socket): void;
  };
  const calls = new Map<string, Call>();

  return context => {
    const mode = context.url.searchParams.get("transport");
    if (mode !== "buffered" && mode !== "resume") return start(context);
    const thread = context.url.searchParams.get("threadId") ?? "";
    let call: Call | undefined;
    let handshake: ReturnType<typeof setTimeout> | undefined;
    return {
      onOpen(socket) {
        if (mode === "resume") {
          handshake = setTimeout(() => socket.close(1008, "Resume timed out"), GRACE_MS);
          return;
        }
        const token = randomUUID();
        const handler = start(context);
        let peer: Socket | null = socket;
        let expiry: ReturnType<typeof setTimeout> | undefined;
        let seq = 0;
        let bytes = 0;
        const history: Array<{ seq: number; wire: string; size: number }> = [];
        const release = () => {
          clearTimeout(expiry);
          calls.delete(token);
          history.length = 0;
        };
        const relay: Socket = {
          get readyState() { return calls.has(token) ? 1 : 3; },
          send(data) {
            const wire = JSON.stringify({ seq: ++seq, event: JSON.parse(String(data)) });
            const size = Buffer.byteLength(wire);
            history.push({ seq, wire, size });
            bytes += size;
            while (bytes > MAX_REPLAY_BYTES || history.length > 512) bytes -= history.shift()!.size;
            if (peer?.readyState === 1) peer.send(wire);
          },
          close(code, reason) {
            release();
            peer?.close(code, reason);
            peer = null;
          },
        };
        call = {
          thread,
          attach(next, after) {
            if (!Number.isSafeInteger(after) || after < (history[0]?.seq ?? seq + 1) - 1 || after > seq) return false;
            clearTimeout(expiry);
            const previous = peer;
            peer = next;
            previous?.close(1000, "Resumed");
            next.send(JSON.stringify({ type: "RESUMED" }));
            for (const frame of history) if (frame.seq > after) next.send(frame.wire);
            return true;
          },
          receive(from, data) {
            if (peer === from) void handler.onMessage?.(relay, data);
          },
          detach(from) {
            if (peer !== from || !calls.has(token)) return;
            peer = null;
            expiry = setTimeout(() => {
              release();
              void handler.onClose?.(relay, { code: 1001, reason: "Resume window expired" });
            }, GRACE_MS);
          },
        };
        calls.set(token, call);
        socket.send(JSON.stringify({ type: "RESUME_TOKEN", token }));
        return handler.onOpen?.(relay);
      },
      onMessage(socket, data) {
        if (call) return call.receive(socket, data);
        clearTimeout(handshake);
        if (typeof data === "string" && data.length <= 160) {
          try {
            const { token, after } = JSON.parse(data);
            const saved = calls.get(token);
            if (saved && saved.thread === thread && saved.attach(socket, after)) {
              call = saved;
              return;
            }
          } catch { /* Malformed handshake. */ }
        }
        socket.close(1008, "Call no longer available");
      },
      onClose(socket) { clearTimeout(handshake); call?.detach(socket); },
      onError(socket) { clearTimeout(handshake); call?.detach(socket); },
    };
  };
}
