"""FastAPI app entry point."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .config import get_settings
from .db import close_engine, get_engine
from .posthog_client import init_posthog, shutdown_posthog
from .routers import (
    assets,
    corpus,
    messages,
    parse_fault_dump,
    parts,
    photos,
    tickets,
    uploads,
    users,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_posthog()
    get_engine()  # warm the connection pool
    yield
    await close_engine()
    shutdown_posthog()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Railio", lifespan=lifespan)

    # Mirror backend/middleware.ts: allow exact match + *.vercel.app wildcards.
    allow_origins: list[str] = []
    allow_origin_regex: str | None = None
    wildcards: list[str] = []
    for o in settings.allowed_origins:
        if o.startswith("*."):
            wildcards.append(o[1:])
        else:
            allow_origins.append(o)
    if wildcards:
        # Match origin scheme + suffix. E.g. *.vercel.app → https://*.vercel.app
        pat = "|".join(w.replace(".", r"\.") for w in wildcards)
        allow_origin_regex = rf"^https://[a-zA-Z0-9-]+({pat})$"

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_origin_regex=allow_origin_regex,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-Org-Id"],
        max_age=86400,
    )

    @app.exception_handler(ValueError)
    async def handle_value_error(_req: Request, exc: ValueError) -> JSONResponse:
        return JSONResponse({"error": str(exc)}, status_code=400)

    @app.get("/")
    async def root() -> Response:
        return JSONResponse({"ok": True, "service": "railio"})

    app.include_router(assets.router, prefix="/api/assets", tags=["assets"])
    app.include_router(tickets.router, prefix="/api/tickets", tags=["tickets"])
    app.include_router(messages.router, prefix="/api/tickets", tags=["messages"])
    app.include_router(parse_fault_dump.router, prefix="/api/tickets", tags=["parse_fault_dump"])
    app.include_router(photos.router, prefix="/api/tickets", tags=["photos"])
    app.include_router(parts.router, prefix="/api/parts", tags=["parts"])
    app.include_router(corpus.router, prefix="/api/corpus", tags=["corpus"])
    app.include_router(uploads.router, prefix="/api/uploads", tags=["uploads"])
    app.include_router(users.router, prefix="/api", tags=["users"])

    return app


app = create_app()


def main() -> None:
    """Console entry point: `python -m railio.main`."""
    import uvicorn

    settings = get_settings()
    uvicorn.run("railio.main:app", host="0.0.0.0", port=settings.port, reload=True)


if __name__ == "__main__":
    main()
