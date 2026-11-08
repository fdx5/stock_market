"""Validate public JSON before compression; gzip headers contain a varying timestamp."""
import hashlib
import json

from fastapi import Request
from fastapi.responses import Response

EXCLUSIONS = ("/api/admin", "/api/activity", "/api/notify", "/api/visitors")


async def validate_public_json(request: Request, call_next):
    response = await call_next(request)
    if (request.method != "GET" or not request.url.path.startswith("/api/")
            or request.url.path.startswith(EXCLUSIONS)
            or response.status_code != 200
            or not response.headers.get("content-type", "").startswith("application/json")
            or response.headers.get("set-cookie")
            or "private" in response.headers.get("cache-control", "").lower()
            or request.headers.get("authorization")):
        return response

    body = b"".join([chunk async for chunk in response.body_iterator])
    validator_body = body
    try:
        payload = json.loads(body)
        if isinstance(payload, dict) and "generated_at" in payload:
            payload = {key: value for key, value in payload.items() if key != "generated_at"}
            validator_body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    except (UnicodeDecodeError, json.JSONDecodeError):
        pass
    etag = '"' + hashlib.blake2b(validator_body, digest_size=16).hexdigest() + '"'
    headers = dict(response.headers)
    headers["etag"] = etag
    # Retain a representation for validation, always revalidate before reuse.
    # An upstream max-age must not turn a fresh quote request into a stale read.
    headers["cache-control"] = "public, no-cache"
    headers["content-length"] = str(len(body))
    validators = [tag.strip().removeprefix("W/") for tag in request.headers.get("if-none-match", "").split(",")]
    if etag in validators or "*" in validators:
        return Response(status_code=304, headers={key: value for key, value in headers.items()
                        if key in {"etag", "cache-control", "vary", "date"}}, background=response.background)
    return Response(content=body, status_code=response.status_code, headers=headers,
                    media_type=None, background=response.background)
