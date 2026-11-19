"""BB PCM to Codex V3 WebRTC. One process, one ephemeral Codex session per call."""
import asyncio
import base64
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
from fractions import Fraction

MODEL = "gpt-live-1.1-codex"
RUNTIME = Path.home() / ".local/share/bb-voice-mode/codex-live"


def install():
    RUNTIME.mkdir(mode=0o700, parents=True, exist_ok=True)
    python = RUNTIME / "venv/bin/python"
    if not python.exists():
        subprocess.run([sys.executable, "-m", "venv", str(RUNTIME / "venv")], check=True)
    subprocess.run([str(python), "-m", "pip", "install", "--only-binary=:all:", "aiortc==1.16.0"], check=True)
    if not shutil.which("codex"):
        raise RuntimeError("Codex CLI is required on the BB server")
    with tempfile.NamedTemporaryFile(dir=RUNTIME, delete=False) as tmp:
        tmp.write(Path(__file__).read_bytes())
    os.replace(tmp.name, RUNTIME / "codex_voice.py")


def emit(kind, **fields):
    print(json.dumps({"type": kind, **fields}, ensure_ascii=False), flush=True)


async def run():
    from aiortc import AudioStreamTrack, RTCConfiguration, RTCPeerConnection, RTCSessionDescription
    from aiortc.mediastreams import MediaStreamError
    from av import AudioFrame, AudioResampler

    loop = asyncio.get_running_loop()
    stdin = asyncio.StreamReader(limit=512 * 1024)
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(stdin), sys.stdin.buffer)
    start = json.loads(await stdin.readline())
    if start.get("type") != "session.start":
        return
    cfg = start["session"]
    if cfg.get("model") != MODEL:
        raise ValueError("Unexpected Codex voice model")
    pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))
    done = asyncio.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, done.set)
    audio = bytearray()
    pending = {}
    tasks = set()
    seq = 0
    tid = None
    process = None

    class Mic(AudioStreamTrack):
        async def recv(self):
            # Pace mono chunks at 20 ms even while muted or acquiring a mic.
            base = await super().recv()
            chunk = bytes(audio[:960])
            del audio[:960]
            frame = AudioFrame(format="s16", layout="mono", samples=480)
            frame.planes[0].update(chunk.ljust(960, b"\x00"))
            frame.pts = base.pts * 3
            frame.time_base = Fraction(1, 24000)
            frame.sample_rate = 24000
            return frame

    def spawn(coro):
        task = asyncio.create_task(coro)
        tasks.add(task)
        def settled(t):
            tasks.discard(t)
            if not t.cancelled() and t.exception() is not None:
                done.set()
        task.add_done_callback(settled)

    def write(value):
        process.stdin.write((json.dumps(value) + "\n").encode())

    async def rpc(method, params):
        nonlocal seq
        seq += 1
        ident = seq
        future = loop.create_future()
        pending[ident] = future
        try:
            write(dict(id=ident, method=method, params=params))
            return await asyncio.wait_for(future, 12)
        finally:
            pending.pop(ident, None)

    async def read_codex():
        async for line in process.stdout:
            msg = json.loads(line)
            ident = msg.get("id")
            method = msg.get("method", "")
            if ident is not None and not method:
                future = pending.get(ident)
                if future and not future.done():
                    if "error" in msg:
                        future.set_exception(RuntimeError("Codex request failed"))
                    else:
                        future.set_result(msg.get("result"))
                continue
            p = msg.get("params") or {}
            if ident is not None:
                write({"id": ident, "error": {"code": -32601, "message": "Voice client cannot run tools or approve actions"}})
            elif p.get("threadId") == tid:
                if method == "thread/realtime/sdp":
                    await pc.setRemoteDescription(RTCSessionDescription(sdp=p["sdp"], type="answer"))
                elif method in ("thread/realtime/error", "thread/realtime/closed"):
                    done.set()
                elif method == "turn/started":
                    # Codex also admits a local handoff turn. BB owns the work.
                    spawn(rpc("turn/interrupt", {"threadId": tid, "turnId": p["turn"]["id"]}))
        done.set()

    async def speaker(track):
        resample = AudioResampler(format="s16", layout="mono", rate=24000)
        try:
            while not done.is_set():
                for frame in resample.resample(await track.recv()):
                    pcm = bytes(frame.planes[0])[:frame.samples * 2]
                    if any(pcm):
                        emit("session.output_audio.delta", delta=base64.b64encode(pcm).decode())
        except MediaStreamError:
            done.set()

    pc.addTrack(Mic())
    pc.on("track", lambda track: spawn(speaker(track)))
    dc = pc.createDataChannel("oai-events")

    @pc.on("connectionstatechange")
    def state():
        if pc.connectionState in ("failed", "closed"):
            done.set()

    @dc.on("close")
    def closed():
        done.set()

    @dc.on("message")
    def event(raw):
        msg = json.loads(raw)
        kind = msg.get("type")
        item = msg.get("item") or {}
        if kind == "session.started":
            emit(kind)
        elif kind in ("input_transcript.added", "output_transcript.added"):
            role = kind.split("_")[0]
            emit("session." + role + "_transcript.delta", event_id=item["id"], delta=item["text"],
                 start_ms=msg["start_ms"], end_ms=msg["end_ms"])
        elif kind == "delegation.created" and item.get("target") == "client":
            emit("session.delegation.created", event_id=item["id"], offset_ms=msg["offset_ms"],
                 delegation={"id": item["id"], "target": "client"})
        elif kind == "error":
            error = msg.get("error") or {}
            emit("error", error={"code": str(error.get("code", "connection_lost"))})
            done.set()
        elif kind == "session.closed":
            emit(kind, reason=msg.get("reason"))
            done.set()

    async def incoming():
        async for line in stdin:
            msg = json.loads(line)
            kind = msg.get("type")
            if kind == "session.close":
                emit("session.closed", reason="close_requested")
                break
            if kind == "session.input_audio.append":
                audio.extend(base64.b64decode(msg["audio"], validate=True))
                if len(audio) > 48000:
                    del audio[:-48000]
            elif kind == "session.commentary.append":
                await rpc("thread/realtime/appendSpeech", {"threadId": tid, "text": msg["content"]})
            elif kind == "session.thinking.append":
                await rpc("thread/realtime/appendText", {"threadId": tid, "role": "assistant", "text": msg["content"]})
        done.set()

    with tempfile.TemporaryDirectory(prefix="bb-voice-codex-") as cwd:
        try:
            process = await asyncio.create_subprocess_exec("codex", "app-server", "--enable", "realtime_conversation",
                cwd=cwd, stdin=-1, stdout=-1, stderr=asyncio.subprocess.DEVNULL, limit=2*1024*1024)
            spawn(read_codex())
            await rpc("initialize", {"clientInfo": {"name": "bb_voice_mode", "version": "1"}, "capabilities": {"experimentalApi": True}})
            write({"method": "initialized"})
            thread = await rpc("thread/start", {"cwd": cwd, "ephemeral": True, "approvalPolicy": "never",
                "sandbox": "read-only", "environments": [], "baseInstructions": "BB handles every voice task. Do not run tools or perform work."})
            tid = thread["thread"]["id"]
            await pc.setLocalDescription(await pc.createOffer())
            await rpc("thread/realtime/start", {"threadId": tid, "model": MODEL, "version": "v3",
                "outputModality": "audio", "transport": {"type": "webrtc", "sdp": pc.localDescription.sdp},
                "voice": cfg["audio"]["output"]["voice"], "prompt": cfg["instructions"], "includeStartupContext": False,
                "clientManagedHandoffs": True, "realtimeStartInstructions": "BB owns all delegated work. Do not act or use tools."})
            spawn(incoming())
            await done.wait()
        finally:
            done.set()
            if process and tid and process.returncode is None:
                try:
                    await asyncio.wait_for(rpc("thread/realtime/stop", {"threadId": tid}), 1)
                except (Exception, asyncio.CancelledError):
                    pass
            await pc.close()
            for task in list(tasks):
                task.cancel()
            if process and process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), 2)
                except asyncio.TimeoutError:
                    process.kill()
                    await process.wait()


if __name__ == "__main__":
    if sys.argv[1:] == ["--install"]:
        install()
    else:
        asyncio.run(run())
