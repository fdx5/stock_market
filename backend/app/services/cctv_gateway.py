"""One authenticated reverse WSS worker; keys use memory and encrypted transit only.

The public service stores only an Ed25519 public key. The domestic worker proves
possession of its private key, then handles bounded CCTV GET jobs. There is no
general proxy endpoint, inbound domestic port, database, or persisted media.
"""
import asyncio
import base64
from dataclasses import dataclass
import json
import os
import secrets
import threading
import time

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import WebSocket

from .cctv_gateway_protocol import CHALLENGE_CONTEXT, GatewayUnavailable, gateway_required, unpack_reply, validate_target


@dataclass
class GatewayReply:
    status: int
    body: bytes
    content_type: str
    final_url: str


class _Connection:
    def __init__(self, socket):
        self.socket = socket
        self.loop = asyncio.get_running_loop()
        self.write_lock = asyncio.Lock()
        self.pending = {}
        self.connected_at = time.monotonic()
        self.last_seen = self.connected_at

    async def send(self, message):
        async with self.write_lock:
            await self.socket.send_json(message)

    async def fetch(self, url, kind):
        if len(self.pending) >= 8:
            raise GatewayUnavailable("Domestic CCTV gateway is busy")
        job = secrets.token_hex(16)
        future = self.loop.create_future()
        self.pending[job] = (future, kind)
        try:
            await self.send({"type": "get", "id": job, "url": url, "kind": kind})
            return await asyncio.wait_for(future, 20)
        finally:
            self.pending.pop(job, None)


_connection = None
_guard = threading.Lock()
_handshakes = threading.BoundedSemaphore(2)


def required():
    return gateway_required()


def status():
    with _guard:
        conn = _connection
    return {"required": required(), "configured": bool(os.environ.get("CCTV_GATEWAY_PUBLIC_KEY", "").strip()),
            "connected": bool(conn and time.monotonic() - conn.last_seen < 60),
            "connected_s": int(time.monotonic() - conn.connected_at) if conn else None}


def fetch(url, kind):
    validate_target(url, kind)
    with _guard:
        conn = _connection
    if conn is None or time.monotonic() - conn.last_seen >= 60:
        raise GatewayUnavailable("Domestic CCTV gateway is offline")
    task = asyncio.run_coroutine_threadsafe(conn.fetch(url, kind), conn.loop)
    try:
        return task.result(timeout=23)
    except Exception:
        task.cancel()
        raise GatewayUnavailable("Domestic CCTV gateway did not complete the request") from None


async def serve(socket: WebSocket):
    global _connection
    encoded_key = os.environ.get("CCTV_GATEWAY_PUBLIC_KEY", "").strip()
    # Browser origins are never agents. Unconfigured or busy handshakes fail closed.
    if not encoded_key or socket.headers.get("origin") or not _handshakes.acquire(blocking=False):
        await socket.close(code=1008)
        return
    conn = None
    authenticated = False
    try:
        public_key = Ed25519PublicKey.from_public_bytes(base64.b64decode(encoded_key, validate=True))
        await socket.accept()
        nonce = secrets.token_bytes(32)
        await socket.send_json({"type": "challenge", "nonce": base64.b64encode(nonce).decode(), "version": 1})
        hello = await asyncio.wait_for(socket.receive_text(), 5)
        if len(hello) > 512:
            raise ValueError("Invalid gateway handshake")
        signature = base64.b64decode(json.loads(hello)["signature"], validate=True)
        public_key.verify(signature, CHALLENGE_CONTEXT + nonce)
        conn = _Connection(socket)
        with _guard:
            if _connection is not None:
                raise GatewayUnavailable("Domestic CCTV gateway is already connected")
            _connection = conn
        authenticated = True
        await conn.send({"type": "ready", "version": 1})
    except Exception:
        await socket.close(code=1008)
    finally:
        _handshakes.release()
    if not authenticated:
        return
    try:
        while True:
            message = await asyncio.wait_for(socket.receive(), 55)
            if message["type"] == "websocket.disconnect":
                break
            conn.last_seen = time.monotonic()
            if message.get("bytes") is not None:
                header, body = unpack_reply(message["bytes"])
                pending = conn.pending.get(header["id"])
                if not pending:
                    continue
                future, kind = pending
                if header["status"] == 200:
                    validate_target(header["final_url"], kind)
                if not future.done():
                    future.set_result(GatewayReply(header["status"], body, header["content_type"], header["final_url"]))
            elif message.get("text") is not None:
                if len(message["text"]) > 128 or json.loads(message["text"]).get("type") != "heartbeat":
                    raise ValueError("Invalid gateway message")
                await conn.send({"type": "heartbeat"})
    except Exception:
        pass  # Never log messages or exceptions that may carry provider URLs/keys.
    finally:
        with _guard:
            if _connection is conn:
                _connection = None
        for future, _ in tuple(conn.pending.values()):
            if not future.done():
                future.set_exception(GatewayUnavailable("Domestic CCTV gateway disconnected"))
        try:
            await socket.close(code=1001)
        except Exception:
            pass
