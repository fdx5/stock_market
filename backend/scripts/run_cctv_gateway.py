"""Operator-owned domestic CCTV worker. No inbound listening port or database.

Install: pip install cryptography websockets requests urllib3
Initialize a new protected key file with --init-key, then register ONLY the printed
public key as CCTV_GATEWAY_PUBLIC_KEY on the service. Never share the private file.
"""
import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import random
import sys
import urllib.request
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
import websockets

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.cctv_gateway_protocol import CHALLENGE_CONTEXT, MAX_BODY, MAX_HEADER, pack_reply, validate_target
from app.services.traffic_cctv import MediaProviderError, _public_fetch_direct


def read_key(path):
    return serialization.load_pem_private_key(path.read_bytes(), password=None)


def initialize(path):
    key = Ed25519PrivateKey.generate()
    path.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation preserves any existing identity; no overwrite or cleanup.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    print(base64.b64encode(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)).decode())


def country():
    with urllib.request.urlopen("https://ipinfo.io/json", timeout=10) as response:
        return json.load(response).get("country")


def retrieve(job):
    try:
        if not isinstance(job.get("id"), str) or len(job["id"]) != 32:
            raise ValueError("Invalid request identity")
        url, kind = job.get("url"), job.get("kind")
        validate_target(url, kind)
        body, content_type, final = _public_fetch_direct(url, validator=lambda destination: validate_target(destination, kind))
        return pack_reply(job["id"], 200, body, content_type, final)
    except MediaProviderError as error:
        return pack_reply(job.get("id", ""), error.status)
    except Exception:
        # URLs and exception strings can contain the ITS key. Return a code only.
        return pack_reply(job.get("id", ""), 502)


async def session(endpoint, key):
    async with websockets.connect(endpoint, max_size=8192, ping_interval=20, ping_timeout=20, open_timeout=12) as socket:
        challenge = json.loads(await asyncio.wait_for(socket.recv(), 8))
        if challenge.get("type") != "challenge" or challenge.get("version") != 1:
            raise ValueError("Invalid gateway challenge")
        nonce = base64.b64decode(challenge["nonce"], validate=True)
        if len(nonce) != 32:
            raise ValueError("Invalid gateway challenge")
        signature = key.sign(CHALLENGE_CONTEXT + nonce)
        await socket.send(json.dumps({"signature": base64.b64encode(signature).decode()}))
        if json.loads(await asyncio.wait_for(socket.recv(), 8)).get("type") != "ready":
            raise ValueError("Gateway authentication failed")
        print("Domestic CCTV gateway connected", flush=True)
        slots = asyncio.Semaphore(4)
        pending = set()

        async def handle(job):
            async with slots:
                packet = await asyncio.to_thread(retrieve, job)
                await socket.send(packet)

        async def heartbeat():
            while True:
                await asyncio.sleep(20)
                await socket.send('{"type":"heartbeat"}')

        pulse = asyncio.create_task(heartbeat())
        def completed(task):
            pending.discard(task)
            if not task.cancelled():
                task.exception()
        try:
            async for raw in socket:
                if not isinstance(raw, str) or len(raw) > 8192:
                    raise ValueError("Invalid gateway request")
                job = json.loads(raw)
                if job.get("type") == "heartbeat":
                    continue
                if job.get("type") != "get" or len(pending) >= 8:
                    raise ValueError("Unsupported gateway request")
                task = asyncio.create_task(handle(job))
                pending.add(task)
                task.add_done_callback(completed)
        finally:
            pulse.cancel()
            for task in pending:
                task.cancel()
            await asyncio.gather(pulse, *pending, return_exceptions=True)


async def run(endpoint, key):
    delay = 2
    while True:
        try:
            await session(endpoint, key)
        except Exception:
            print("Domestic CCTV gateway disconnected; reconnecting", flush=True)
        await asyncio.sleep(delay + random.random())
        delay = min(30, delay * 1.5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--key-file", type=Path, required=True)
    parser.add_argument("--init-key", action="store_true")
    parser.add_argument("--endpoint", default="wss://kospimap.com/api/realestate/cctv/gateway")
    parser.add_argument("--allow-local-test", action="store_true")
    args = parser.parse_args()
    if args.init_key:
        initialize(args.key_file)
    else:
        p = urlsplit(args.endpoint)
        local_test = args.allow_local_test and p.scheme == "ws" and p.hostname in ("127.0.0.1", "localhost")
        if (p.scheme != "wss" or p.username or p.password or p.query or p.fragment) and not local_test:
            parser.error("The production endpoint must use WSS without URL credentials")
        if not local_test and country() != "KR":
            parser.error("Run this CCTV egress worker on a verified Korean network")
        asyncio.run(run(args.endpoint, read_key(args.key_file)))
