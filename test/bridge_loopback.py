"""Offline Codex Live integration check. Run with the bridge's venv Python."""
import asyncio
import json
import os
from pathlib import Path
import shlex
import sys
import tempfile
import unittest

from aiortc import RTCConfiguration, RTCPeerConnection, RTCSessionDescription

BRIDGE = Path(__file__).resolve().parents[1] / "codex_voice.py"


async def local_peer():
    """Serve only the Codex RPCs the bridge needs, using a local WebRTC peer."""
    pc = RTCPeerConnection(RTCConfiguration(iceServers=[]))

    @pc.on("datachannel")
    def opened(channel):
        channel.send(json.dumps({"type": "session.started"}))

    def send(message):
        print(json.dumps(message), flush=True)

    try:
        while line := await asyncio.to_thread(sys.stdin.readline):
            request = json.loads(line)
            if "id" not in request:
                continue
            method = request["method"]
            args = request.get("params") or {}
            result = {}
            if method == "thread/start":
                result = {"thread": {"id": "test"}}
            if method == "thread/realtime/start":
                if args["voice"] != "juniper" or args["model"] != "gpt-live-1.1-codex":
                    raise ValueError("Unexpected voice or model")
                await pc.setRemoteDescription(RTCSessionDescription(args["transport"]["sdp"], "offer"))
                await pc.setLocalDescription(await pc.createAnswer())
                send({"method": "thread/realtime/sdp", "params": {"threadId": "test", "sdp": pc.localDescription.sdp}})
            send({"id": request["id"], "result": result})
            if method == "thread/realtime/appendText":
                # Lose the model transport while the browser side remains open.
                return
    finally:
        await pc.close()


class LoopbackTest(unittest.IsolatedAsyncioTestCase):
    async def test_juniper_and_upstream_disconnect(self):
        with tempfile.TemporaryDirectory() as tmp:
            executable = Path(tmp) / "codex"
            executable.write_text("#!/bin/sh\nexec " + shlex.join([sys.executable, str(Path(__file__).resolve()), "--peer"]) + "\n")
            executable.chmod(0o700)
            env = {**os.environ, "PATH": tmp + os.pathsep + os.environ["PATH"]}
            process = await asyncio.create_subprocess_exec(
                sys.executable, str(BRIDGE), stdin=-1, stdout=-1, env=env)

            def send(message):
                process.stdin.write((json.dumps(message) + "\n").encode())

            try:
                send({"type": "session.start", "session": {
                    "model": "gpt-live-1.1-codex", "instructions": "Loopback",
                    "audio": {"output": {"voice": "juniper"}}}})
                event = await asyncio.wait_for(process.stdout.readline(), 15)
                self.assertEqual(json.loads(event)["type"], "session.started")
                send({"type": "session.thinking.append", "content": "test disconnect"})
                await asyncio.wait_for(process.wait(), 6)
                self.assertEqual(process.returncode, 0)
            finally:
                if process.returncode is None:
                    process.kill()
                    await process.wait()


if __name__ == "__main__":
    if sys.argv[1:] == ["--peer"]:
        asyncio.run(local_peer())
    else:
        unittest.main()
