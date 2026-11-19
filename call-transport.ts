import type { BrowserToServer, ServerToBrowser } from "./server";

export class CallTransport {
  private socket?: WebSocket;
  private token?: string;
  private lastSeq = 0;
  private attempt = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private connected = false;
  private pendingReady = false;
  private readonly mic: string[] = [];

  constructor(private readonly url: string, private readonly receive: (event: ServerToBrowser) => void,
              private readonly disconnected: () => void) {
    this.connect(false);
  }

  private connect(resume: boolean) {
    const url = new URL(this.url);
    url.searchParams.set("transport", resume ? "resume" : "buffered");
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onopen = () => {
      if (resume) socket.send(JSON.stringify({ token: this.token, after: this.lastSeq }));
      else this.connected = true;
    };
    socket.onmessage = event => {
      if (this.stopped || this.socket !== socket) return;
      const frame = JSON.parse(String(event.data));
      if (frame.type === "RESUME_TOKEN") {
        this.token = frame.token;
      } else if (frame.type === "RESUMED") {
        this.connected = true;
        this.attempt = 0;
        clearTimeout(this.deadline);
        this.deadline = undefined;
        if (this.pendingReady) this.send({ type: "CLIENT_READY" });
        this.pendingReady = false;
        for (const wire of this.mic.splice(0)) socket.send(wire);
      } else if (frame.seq === undefined) {
        // A rolling upgrade can still reach a server using the original wire format.
        this.receive(frame);
      } else if (frame.seq === this.lastSeq + 1) {
        this.lastSeq = frame.seq;
        this.receive(frame.event);
      }
    };
    socket.onclose = event => {
      if (this.stopped || this.socket !== socket) return;
      this.connected = false;
      if (!this.token || event.code === 1000 || event.code === 1008) return this.fail();
      if (!this.deadline) {
        this.deadline = setTimeout(() => this.fail(), 7500);
      }
      this.retry = setTimeout(() => this.connect(true), Math.min(1600, 120 * 2 ** this.attempt++));
    };
    // WebSocket dispatches close after a transport error.
  }

  send(message: BrowserToServer) {
    if (this.stopped) return;
    if (this.connected && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else if (this.token && message.type === "AUDIO") {
      this.mic.push(JSON.stringify(message));
      if (this.mic.length > 24) this.mic.shift();
    } else if (message.type === "CLIENT_READY") this.pendingReady = true;
  }

  private fail() {
    this.close();
    this.disconnected();
  }

  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearTimeout(this.deadline);
    this.mic.length = 0;
    this.socket?.close();
  }
}
