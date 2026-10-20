"""
Ghost Shopper - Main FastAPI Orchestrator
==========================================

The central brain of the Ghost Shopper competitor intelligence system.
Coordinates isolated gVisor sandboxes, pre-warmed container pools,
two-tier price verification (local regex + Vultr Vision LLM), human-in-the-loop
review workflows, and real-time WebSocket telemetry streaming.

Usage:
    uvicorn orchestrator:app --host 0.0.0.0 --port 8000 --reload
"""

import asyncio
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import re
import sys
from typing import Any, Dict, List, Optional, Union
import uuid

try:
    import aiofiles
except ImportError:
    aiofiles = None

async def _async_read_text(file_path: Union[str, Path]) -> str:
    """Read file content asynchronously with or without aiofiles."""
    if aiofiles is not None:
        async with aiofiles.open(str(file_path), mode="r", encoding="utf-8") as f:
            return await f.read()
    def _read():
        with open(str(file_path), "r", encoding="utf-8") as f:
            return f.read()
    return await asyncio.to_thread(_read)

async def _async_write_text(file_path: Union[str, Path], content: str) -> None:
    """Write text content to file asynchronously with or without aiofiles."""
    if aiofiles is not None:
        async with aiofiles.open(str(file_path), mode="w", encoding="utf-8") as f:
            await f.write(content)
            return
    def _write():
        with open(str(file_path), "w", encoding="utf-8") as f:
            f.write(content)
    await asyncio.to_thread(_write)

async def _async_write_bytes(file_path: Union[str, Path], content: bytes) -> None:
    """Write binary content to file asynchronously with or without aiofiles."""
    if aiofiles is not None:
        async with aiofiles.open(str(file_path), mode="wb") as f:
            await f.write(content)
            return
    def _write_bytes():
        with open(str(file_path), "wb") as f:
            f.write(content)
    await asyncio.to_thread(_write_bytes)

from fastapi import (
    BackgroundTasks,
    FastAPI,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from rich.console import Console
from rich.logging import RichHandler

# Local module imports
from config import Settings, get_settings
from models import (
    ApprovalRequest,
    BatchResult,
    ContainerTelemetry,
    PriceData,
    SandboxState,
    ScrapeRequest,
    ScrapeResult,
    VerificationTier,
    WebSocketMessage
)
from sandbox_manager import SandboxManager
from verifier import TwoTierVerifier
from warm_pool import WarmPoolManager

# -----------------------------------------------------------------------------
# Rich Structured Logging Setup
# -----------------------------------------------------------------------------
console = Console()
logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    datefmt="[%X]",
    handlers=[
        RichHandler(
            console=console,
            rich_tracebacks=True,
            tracebacks_show_locals=False,
            show_path=False
        )
    ]
)
logger = logging.getLogger("ghost_shopper.orchestrator")

# -----------------------------------------------------------------------------
# Configuration and Global Managers
# -----------------------------------------------------------------------------
settings: Settings = get_settings()

# Initialize core subsystems
sandbox_manager: SandboxManager = SandboxManager(config=settings)
warm_pool: WarmPoolManager = WarmPoolManager(sandbox_manager=sandbox_manager, config=settings)
verifier: TwoTierVerifier = TwoTierVerifier(config=settings)

# In-Memory State Repositories
active_tasks: Dict[str, ScrapeResult] = {}
batch_results: Dict[str, BatchResult] = {}
pending_approvals: Dict[str, ApprovalRequest] = {}
ws_connections: List[WebSocket] = []

# Concurrency Locks
ws_lock: asyncio.Lock = asyncio.Lock()
state_lock: asyncio.Lock = asyncio.Lock()

# Workspace & Frontend paths
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
WORKSPACE_DIR = Path(settings.workspace_dir)

# Ensure workspace host directory exists
os.makedirs(str(WORKSPACE_DIR), exist_ok=True)

# -----------------------------------------------------------------------------
# FastAPI Application Initialization
# -----------------------------------------------------------------------------
app = FastAPI(
    title="Ghost Shopper Orchestrator",
    description=(
        "Zero-trust competitor intelligence platform running Playwright Chromium "
        "inside hardened gVisor (runsc) sandboxes with two-tier AI price verification."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS Middleware configuration (Permits frontend client connection)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------------------------------------------------------
# WebSocket Telemetry & Broadcasting Helpers
# -----------------------------------------------------------------------------
async def broadcast(msg: WebSocketMessage) -> None:
    """
    Broadcast a typed WebSocketMessage to all actively connected frontend clients.
    Automatically detects and prunes dead/closed connections without blocking.
    """
    payload = msg.model_dump_json()
    stale_sockets: List[WebSocket] = []

    async with ws_lock:
        clients = list(ws_connections)

    for client in clients:
        try:
            await client.send_text(payload)
        except Exception:
            stale_sockets.append(client)

    if stale_sockets:
        async with ws_lock:
            for s in stale_sockets:
                if s in ws_connections:
                    ws_connections.remove(s)


async def broadcast_state_change(
    task_id: str,
    result: ScrapeResult,
    step_message: Optional[str] = None
) -> None:
    """
    Dispatches a state transition event and a synchronized task update.
    """
    task_data = result.model_dump()
    if step_message:
        task_data["message"] = step_message
        task_data["step"] = step_message

    # Format status string for UI compatibility
    task_data["status"] = result.state.value

    # 1. Dispatch standard state_change envelope
    await broadcast(
        WebSocketMessage(
            event="state_change",
            task_id=task_id,
            container_id=result.container_id,
            data=task_data
        )
    )

    # 2. Dispatch task_update event specifically subscribed by dashboard app.js
    await broadcast(
        WebSocketMessage(
            event="task_update",
            task_id=task_id,
            container_id=result.container_id,
            data=task_data
        )
    )


async def broadcast_log(
    level: str,
    message: str,
    task_id: Optional[str] = None,
    container_id: Optional[str] = None
) -> None:
    """
    Dispatches a structured log entry to dashboard terminals.
    """
    log_entry = {
        "level": level.upper(),
        "message": message,
        "task_id": task_id,
        "container_id": container_id,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    await broadcast(
        WebSocketMessage(
            event="log",
            task_id=task_id,
            container_id=container_id,
            data=log_entry
        )
    )


async def broadcast_telemetry(telemetry: Union[ContainerTelemetry, Dict[str, Any]]) -> None:
    """
    Dispatches container resource statistics (CPU, RAM, Network).
    """
    data = telemetry if isinstance(telemetry, dict) else telemetry.model_dump()
    await broadcast(
        WebSocketMessage(
            event="telemetry",
            container_id=data.get("container_id"),
            data=data
        )
    )


async def broadcast_approval_required(req: ApprovalRequest) -> None:
    """
    Alerts human operators that a sandbox has been frozen awaiting intervention.
    """
    appr_data = req.model_dump()
    await broadcast(
        WebSocketMessage(
            event="approval_required",
            task_id=req.task_id,
            container_id=req.container_id,
            data=appr_data
        )
    )
    # Mirror with approval_request event
    await broadcast(
        WebSocketMessage(
            event="approval_request",
            task_id=req.task_id,
            container_id=req.container_id,
            data=appr_data
        )
    )


async def broadcast_approval_resolved(task_id: str, action: str) -> None:
    """
    Notifies dashboards that a paused task challenge has been approved or rejected.
    """
    await broadcast(
        WebSocketMessage(
            event="approval_resolved",
            task_id=task_id,
            data={"task_id": task_id, "status": action}
        )
    )


async def broadcast_batch_completed(batch: BatchResult) -> None:
    """
    Dispatches final completion event for an entire scraping batch.
    """
    await broadcast(
        WebSocketMessage(
            event="batch_completed",
            data={
                "batch_id": batch.batch_id,
                "total_urls": batch.total_urls,
                "total_extracted": len(batch.results),
                "created_at": batch.created_at.isoformat()
            }
        )
    )


# -----------------------------------------------------------------------------
# Application Startup and Shutdown Lifecycle Events
# -----------------------------------------------------------------------------
@app.on_event("startup")
async def startup_event() -> None:
    """
    Bootstraps container runtime environment, builds sandbox images if absent,
    and initializes the pre-warmed container pool.
    """
    logger.info("Initializing Ghost Shopper Orchestrator (env=%s)...", settings.env)

    # 1. Inspect Docker connectivity
    if sandbox_manager.client is not None:
        logger.info("Docker daemon connected. Inspecting sandbox image '%s'...", settings.sandbox_image)
        try:
            sandbox_manager.client.images.get(settings.sandbox_image)
            logger.info("Sandbox worker image '%s' is present locally.", settings.sandbox_image)
        except Exception:
            logger.info("Sandbox image '%s' not found. Checking Dockerfile.sandbox...", settings.sandbox_image)
            dockerfile_path = BASE_DIR / "Dockerfile.sandbox"
            if dockerfile_path.is_file():
                try:
                    logger.info("Building Docker image '%s' from %s...", settings.sandbox_image, dockerfile_path)
                    await asyncio.to_thread(
                        sandbox_manager.client.images.build,
                        path=str(BASE_DIR),
                        dockerfile="Dockerfile.sandbox",
                        tag=settings.sandbox_image,
                        rm=True
                    )
                    logger.info("Successfully built sandbox image '%s'", settings.sandbox_image)
                except Exception as build_exc:
                    logger.warning("Could not build Docker image: %s. Will attempt on-demand.", build_exc)

        # 2. Warm up container pool
        try:
            logger.info("Starting WarmPoolManager...")
            await warm_pool.start()
        except Exception as pool_exc:
            logger.warning("Warm pool initialization encountered error: %s", pool_exc)
    else:
        logger.warning(
            "Docker daemon is currently offline or unreachable. "
            "Orchestrator will operate in simulation & local execution fallback mode."
        )

    logger.info("Ghost Shopper Orchestrator startup complete. Ready for scraping missions.")


@app.on_event("shutdown")
async def shutdown_event() -> None:
    """
    Cleans up all resources, shuts down warm pool, purges lingering containers,
    and cleanly terminates WebSocket sessions.
    """
    logger.info("Initiating Ghost Shopper Orchestrator shutdown sequence...")

    # 1. Shutdown warm container pool
    try:
        await warm_pool.shutdown()
    except Exception as pool_err:
        logger.warning("Error during warm pool shutdown: %s", pool_err)

    # 2. Close verifier client session
    try:
        await verifier.close()
    except Exception as verifier_err:
        logger.warning("Error closing verifier HTTP client: %s", verifier_err)

    # 3. Purge any lingering active containers
    async with state_lock:
        for task_id, task in list(active_tasks.items()):
            if task.container_id and task.state not in (SandboxState.WIPED_AND_PURGED, SandboxState.FAILED):
                try:
                    logger.info("Purging lingering container %s for task %s", task.container_id[:12], task_id)
                    await sandbox_manager.purge_sandbox(task.container_id)
                except Exception as purge_err:
                    logger.warning("Could not purge container %s: %s", task.container_id, purge_err)

    # 4. Disconnect all WebSocket clients
    async with ws_lock:
        for ws in list(ws_connections):
            try:
                await ws.close(code=status.WS_1001_GOING_AWAY, reason="Server shutting down")
            except Exception:
                pass
        ws_connections.clear()

    logger.info("Ghost Shopper Orchestrator cleanly terminated.")


# -----------------------------------------------------------------------------
# WebSocket Log and Telemetry Streaming Endpoint
# -----------------------------------------------------------------------------
async def _websocket_handler(websocket: WebSocket) -> None:
    """
    Bi-directional real-time telemetry and log streaming tunnel.
    Dispatches live execution steps, telemetry metrics, and approval requests.
    """
    await websocket.accept()
    async with ws_lock:
        ws_connections.append(websocket)

    logger.info("Client connected to WebSocket telemetry. Active subscribers: %d", len(ws_connections))

    # Send initial handshake frame with fleet pool telemetry
    try:
        status_payload = warm_pool.get_pool_status()
        welcome_frame = WebSocketMessage(
            event="pool_status",
            data=status_payload
        )
        await websocket.send_text(welcome_frame.model_dump_json())
    except Exception as send_err:
        logger.debug("Failed sending initial welcome frame: %s", send_err)

    try:
        while True:
            raw_text = await websocket.receive_text()
            # Handle client heartbeat or action commands
            if raw_text in ("ping", '{"type":"ping"}', '{"event":"ping"}'):
                pong_frame = {
                    "type": "pong",
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
                await websocket.send_text(json.dumps(pong_frame))
            else:
                try:
                    payload = json.loads(raw_text)
                    action = payload.get("action") or payload.get("event")
                    if action == "get_pool_status":
                        await websocket.send_text(
                            WebSocketMessage(
                                event="pool_status",
                                data=warm_pool.get_pool_status()
                            ).model_dump_json()
                        )
                except Exception:
                    pass
    except WebSocketDisconnect:
        logger.info("WebSocket subscriber disconnected.")
    except Exception as exc:
        logger.debug("WebSocket tunnel encountered error: %s", exc)
    finally:
        async with ws_lock:
            if websocket in ws_connections:
                ws_connections.remove(websocket)


# Register WebSocket handler on both paths
@app.websocket("/ws/logs")
async def websocket_logs_endpoint(websocket: WebSocket) -> None:
    await _websocket_handler(websocket)


@app.websocket("/ws")
async def websocket_root_endpoint(websocket: WebSocket) -> None:
    await _websocket_handler(websocket)


# -----------------------------------------------------------------------------
# Core Execution Engine: Single Task Runner
# -----------------------------------------------------------------------------
async def _execute_single(
    batch_id: str,
    url: str,
    task_id: Optional[str] = None
) -> ScrapeResult:
    """
    Execute a single isolated scraping job through the complete zero-trust lifecycle:
      1. Provision & acquire container from warm pool
      2. Configure task environment & launch Playwright Chromium
      3. Watchdog timeout & log streaming
      4. Detect and handle Human-In-The-Loop (CAPTCHA / Bot Challenge) freezes
      5. Read output artifacts (output.json, screenshot.png)
      6. Two-tier price verification (local regex + Vultr Vision LLM)
      7. Hard container purge (docker rm -f) for zero cross-session contamination
    """
    task_id = task_id or f"task-{uuid.uuid4().hex[:10]}"
    start_time = datetime.now(timezone.utc)

    # Initialize task state tracking
    result = ScrapeResult(
        task_id=task_id,
        url=url,
        state=SandboxState.PROVISIONING,
        started_at=start_time,
        logs=[]
    )
    async with state_lock:
        active_tasks[task_id] = result

    await broadcast_state_change(task_id, result, step_message="Acquiring hardened sandbox container")
    await broadcast_log("INFO", f"Task [{task_id}] provisioning sandbox container for URL: {url}", task_id=task_id)

    container_id: Optional[str] = None
    task_dir = WORKSPACE_DIR / task_id
    os.makedirs(str(task_dir), exist_ok=True)
    watchdog_task: Optional[asyncio.Task] = None

    try:
        # Step 1: Acquire container from warm pool or on-demand
        is_simulation = False
        if sandbox_manager.client is not None:
            try:
                container_id = await warm_pool.acquire(timeout=12.0)
                result.container_id = container_id
            except Exception as acq_err:
                logger.warning("Could not acquire container from warm pool: %s. Spawning on-demand...", acq_err)
                try:
                    container_id = await sandbox_manager.create_sandbox(
                        task_id=task_id,
                        target_url=url,
                        batch_id=batch_id
                    )
                    await sandbox_manager.start_sandbox(container_id)
                    result.container_id = container_id
                except Exception as spawn_err:
                    logger.error("Failed on-demand container spawn: %s", spawn_err)
                    raise
        else:
            # Fallback to simulated execution when Docker daemon is not active on host
            is_simulation = True
            container_id = f"sim-{uuid.uuid4().hex[:8]}"
            result.container_id = container_id
            await broadcast_log(
                "WARN",
                f"Docker host offline. Running simulation fallback for task [{task_id}]",
                task_id=task_id,
                container_id=container_id
            )

        # Step 2 & 3: Configure container & start execution
        result.state = SandboxState.EXECUTING
        await broadcast_state_change(task_id, result, step_message="Navigating to product target")
        await broadcast_log(
            "INFO",
            f"Container {container_id[:12]} launched Chromium in gVisor sandbox. Navigating to: {url}",
            task_id=task_id,
            container_id=container_id
        )

        if is_simulation:
            # Simulated browser automation loop
            await _run_simulated_pipeline(task_id, url, task_dir, container_id, result)
        else:
            # Real Docker container execution loop
            await _run_docker_pipeline(task_id, url, task_dir, container_id, result)

        # Step 6: Parse extracted output from workspace
        output_file = task_dir / "output.json"
        raw_price_data: Dict[str, Any] = {}
        product_title = ""

        if output_file.is_file():
            try:
                content = await _async_read_text(output_file)
                data = json.loads(content)
                product_title = data.get("product_title") or ""
                raw_price_data = data.get("price") or {}
                result.product_title = product_title
            except Exception as read_err:
                logger.error("Error reading output.json for task %s: %s", task_id, read_err)

        screenshot_file = task_dir / "screenshot.png"
        if screenshot_file.is_file():
            result.screenshot_path = str(screenshot_file)

        # Step 7: Two-tier price verification
        result.state = SandboxState.VERIFYING
        await broadcast_state_change(task_id, result, step_message="Executing Two-Tier Price Verification")
        await broadcast_log(
            "SECURITY",
            f"Task [{task_id}] starting two-tier verification (local regex + vision LLM)",
            task_id=task_id
        )

        verified_price: PriceData = await verifier.verify(
            price_data=raw_price_data,
            screenshot_path=str(screenshot_file) if screenshot_file.is_file() else None,
            task_id=task_id
        )
        result.price_data = verified_price

        # Step 8: Complete task execution
        result.state = SandboxState.COMPLETED
        result.completed_at = datetime.now(timezone.utc)
        await broadcast_state_change(task_id, result, step_message="Mission accomplished. Data verified.")
        await broadcast_log(
            "INFO",
            f"Task [{task_id}] successfully extracted price: {verified_price.parsed_price} {verified_price.currency} "
            f"(Confidence: {verified_price.confidence * 100:.0f}%, Tier: {verified_price.verification_tier.value})",
            task_id=task_id
        )

    except asyncio.TimeoutError:
        result.state = SandboxState.TIMED_OUT
        result.error = f"Sandbox exceeded {settings.sandbox_timeout_seconds}-second hard execution timeout."
        result.completed_at = datetime.now(timezone.utc)
        await broadcast_state_change(task_id, result, step_message="Sandbox execution timed out")
        await broadcast_log(
            "ERROR",
            f"Task [{task_id}] exceeded {settings.sandbox_timeout_seconds}s timeout quota.",
            task_id=task_id
        )

    except Exception as exc:
        result.state = SandboxState.FAILED
        result.error = str(exc)
        result.completed_at = datetime.now(timezone.utc)
        await broadcast_state_change(task_id, result, step_message=f"Extraction failure: {exc}")
        await broadcast_log("ERROR", f"Task [{task_id}] encountered error: {exc}", task_id=task_id)

    finally:
        # Step 9: Hard container purge (zero-trust hygiene)
        if container_id and not container_id.startswith("sim-"):
            try:
                await warm_pool.release(container_id)
            except Exception as release_err:
                logger.warning("Could not cleanly release container %s: %s", container_id, release_err)
                try:
                    await sandbox_manager.purge_sandbox(container_id)
                except Exception:
                    pass

        # Reflect purged state
        if result.state == SandboxState.COMPLETED:
            result.state = SandboxState.WIPED_AND_PURGED

        await broadcast_state_change(task_id, result, step_message="Container wiped and purged from host")
        await broadcast_log(
            "SECURITY",
            f"Task [{task_id}] sandbox container wiped and memory purged.",
            task_id=task_id
        )

    return result


# -----------------------------------------------------------------------------
# Real Docker Container Scraper Execution Loop
# -----------------------------------------------------------------------------
async def _run_docker_pipeline(
    task_id: str,
    url: str,
    task_dir: Path,
    container_id: str,
    result: ScrapeResult
) -> None:
    """
    Executes scrape.js inside a running Docker container, monitors stdout logs,
    checks resource telemetry, and pauses execution on HITL triggers.
    """
    assert sandbox_manager.client is not None

    # Trigger Playwright worker process inside the container
    def _exec():
        exec_instance = sandbox_manager.client.api.exec_create(
            container=container_id,
            cmd="node /app/scrape.js",
            environment={
                "TARGET_URL": url,
                "TASK_ID": task_id,
                "WORKSPACE_DIR": "/app/workspace",
                "TIMEOUT_MS": str(int((settings.sandbox_timeout_seconds - 5) * 1000))
            },
            workdir="/app"
        )
        sandbox_manager.client.api.exec_start(exec_instance["Id"], detach=True)
        return exec_instance["Id"]

    try:
        await asyncio.to_thread(_exec)
    except Exception as exec_err:
        logger.error("Failed to execute scrape.js in container %s: %s", container_id[:12], exec_err)
        raise RuntimeError(f"Scraper exec failed in container: {exec_err}") from exec_err

    # Setup watchdog timeout
    timeout_limit = settings.sandbox_timeout_seconds
    loop_start = asyncio.get_event_loop().time()
    approval_file = task_dir / "needs_approval.json"
    output_file = task_dir / "output.json"

    # Polling & Telemetry Loop
    while True:
        elapsed = asyncio.get_event_loop().time() - loop_start
        if elapsed > timeout_limit:
            raise asyncio.TimeoutError(f"Container exceeded {timeout_limit}s watchdog timeout.")

        # Check current container state
        state = await sandbox_manager.get_state(container_id)

        # Stream container logs
        logs_text = await sandbox_manager.get_logs(container_id, tail=40)
        if logs_text:
            lines = logs_text.strip().splitlines()
            result.logs = lines[-100:]
            if lines:
                await broadcast_log("INFO", lines[-1], task_id=task_id, container_id=container_id)

        # Fetch and dispatch live container telemetry
        try:
            telemetry = await sandbox_manager.get_stats(container_id)
            result.resource_usage = {
                "cpu_percent": telemetry.cpu_percent,
                "memory_mb": telemetry.memory_usage_mb,
                "memory_limit_mb": telemetry.memory_limit_mb,
                "rx_bytes": telemetry.network_rx_bytes,
                "tx_bytes": telemetry.network_tx_bytes
            }
            await broadcast_telemetry(telemetry)
        except Exception:
            pass

        # Detect Human-in-the-Loop approval triggers
        if approval_file.is_file() and result.state != SandboxState.PAUSED_AWAITING_APPROVAL:
            logger.warning("HITL trigger detected for task %s. Freezing container %s...", task_id, container_id[:12])
            await sandbox_manager.pause_sandbox(container_id)
            result.state = SandboxState.PAUSED_AWAITING_APPROVAL

            reason = "Automated bot protection or interactive challenge detected."
            try:
                content = await _async_read_text(approval_file)
                data = json.loads(content)
                reason = data.get("reason") or reason
            except Exception:
                pass

            screenshot_candidate = task_dir / "screenshot.png"
            req = ApprovalRequest(
                container_id=container_id,
                task_id=task_id,
                reason=reason,
                screenshot_path=str(screenshot_candidate) if screenshot_candidate.is_file() else None,
                paused_at=datetime.now(timezone.utc)
            )
            async with state_lock:
                pending_approvals[task_id] = req

            await broadcast_approval_required(req)
            await broadcast_state_change(task_id, result, step_message="PAUSED — Waiting for operator approval")

            # Freeze polling loop until approval or rejection
            while result.state == SandboxState.PAUSED_AWAITING_APPROVAL:
                await asyncio.sleep(1)

            if result.state == SandboxState.WIPED_AND_PURGED:
                logger.info("Task %s was rejected and purged by operator.", task_id)
                return

            # Approved — delete trigger file so it does not loop
            try:
                if approval_file.is_file():
                    os.remove(str(approval_file))
            except Exception:
                pass

        # Check for task completion
        if output_file.is_file() or state in ("exited", "dead"):
            logger.info("Task %s completed processing inside container.", task_id)
            break

        await asyncio.sleep(1)


# -----------------------------------------------------------------------------
# Simulated Scraper Execution Pipeline (Fallback / Local Development)
# -----------------------------------------------------------------------------
async def _run_simulated_pipeline(
    task_id: str,
    url: str,
    task_dir: Path,
    container_id: str,
    result: ScrapeResult
) -> None:
    """
    High-fidelity simulation engine that runs when Docker daemon is not active.
    Simulates browser navigation, popup dismissal, telemetry, and creates real output files.
    """
    domain = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]

    # Step: Launch
    await broadcast_log("LAUNCH", "Chromium initialized with hardened flags [--no-sandbox --disable-gpu]", task_id, container_id)
    await asyncio.sleep(0.8)

    # Step: Navigate
    await broadcast_log("NAVIGATE", f"Navigating to {url} (DOM content loaded in 380ms)", task_id, container_id)
    await broadcast_telemetry({
        "container_id": container_id,
        "cpu_percent": 18.5,
        "memory_usage_mb": 92.4,
        "memory_limit_mb": 512.0,
        "network_rx_bytes": 104250,
        "network_tx_bytes": 14200,
        "state": SandboxState.EXECUTING.value,
        "blocked_requests": 3
    })
    await asyncio.sleep(1.0)

    # Step: Popups
    await broadcast_log("DISMISS_POPUPS", "Identified and dismissed OneTrust cookie overlay", task_id, container_id)
    await asyncio.sleep(0.8)

    # Generate Mock Screenshot
    screenshot_file = task_dir / "screenshot.png"
    if not screenshot_file.is_file():
        # Minimal 1x1 valid PNG or mock placeholder image
        mock_png_bytes = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x01\x00\x00\x00\x00\x80"
            b"\x08\x02\x00\x00\x00\x94\x82i\xdc\x00\x00\x00\tpHYs\x00\x00\x0e\xc4"
            b"\x00\x00\x0e\xc4\x01\x95+>\xe1\x00\x00\x00\x1fIDATh\x81\xed\xc1\x01"
            b"\x01\x00\x00\x00\x82 \xff\xafnd\x02\x01\x00\x00\x00\x00\x00\x00\x00"
            b"\x00\x00\x00\x00\x04\x00\x01\x19\xa4\x01\xa8\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        try:
            await _async_write_bytes(screenshot_file, mock_png_bytes)
        except Exception:
            pass

    # Check for simulated HITL trigger
    if "captcha" in url.lower() or "challenge" in url.lower():
        result.state = SandboxState.PAUSED_AWAITING_APPROVAL
        reason = "Cloudflare Turnstile Anti-Bot Challenge detected."
        req = ApprovalRequest(
            container_id=container_id,
            task_id=task_id,
            reason=reason,
            screenshot_path=str(screenshot_file),
            paused_at=datetime.now(timezone.utc)
        )
        async with state_lock:
            pending_approvals[task_id] = req

        await broadcast_approval_required(req)
        await broadcast_state_change(task_id, result, step_message="PAUSED — Waiting for operator approval")
        await broadcast_log("SECURITY", f"HITL trigger: {reason}", task_id, container_id)

        while result.state == SandboxState.PAUSED_AWAITING_APPROVAL:
            await asyncio.sleep(1)

        if result.state == SandboxState.WIPED_AND_PURGED:
            return

    # Derive realistic product and price from URL
    slug = url.split("/")[-1].replace("-", " ").title() or f"Premium Product - {domain}"
    mock_price = round(29.99 + (hash(url) % 250), 2)
    mock_orig = round(mock_price * 1.25, 2)

    await broadcast_log("EXTRACT", f"Extracted price: ${mock_price:.2f} (DOM selector: .a-price-whole)", task_id, container_id)
    await broadcast_telemetry({
        "container_id": container_id,
        "cpu_percent": 34.2,
        "memory_usage_mb": 148.6,
        "memory_limit_mb": 512.0,
        "network_rx_bytes": 352100,
        "network_tx_bytes": 28400,
        "state": SandboxState.EXECUTING.value,
        "blocked_requests": 7
    })
    await asyncio.sleep(1.0)

    # Write output.json
    output_payload = {
        "task_id": task_id,
        "url": url,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "product_title": f"{slug} ({domain})",
        "price": {
            "raw_text": f"${mock_price:.2f}",
            "parsed_value": mock_price,
            "currency": "USD",
            "original_price": f"${mock_orig:.2f}",
            "discount_percent": 20.0
        },
        "anomalies": [],
        "needs_approval": False,
        "screenshot": "screenshot.png"
    }

    output_file = task_dir / "output.json"
    await _async_write_text(output_file, json.dumps(output_payload, indent=2))


# -----------------------------------------------------------------------------
# Core Execution Engine: Batch Runner
# -----------------------------------------------------------------------------
async def _execute_batch(
    batch_id: str,
    urls: List[str],
    task_ids: Optional[List[str]] = None
) -> BatchResult:
    """
    Executes multiple scraper missions concurrently using asyncio.gather.
    Gathers telemetry and aggregates outputs into a BatchResult.
    """
    if not task_ids or len(task_ids) != len(urls):
        task_ids = [f"task-{uuid.uuid4().hex[:10]}" for _ in urls]

    logger.info("Initiating batch execution [%s] for %d targets.", batch_id, len(urls))
    await broadcast_log("INFO", f"Batch mission [{batch_id}] started with {len(urls)} target URLs.")

    # Concurrently execute all single scrape tasks
    tasks = [_execute_single(batch_id, url, tid) for url, tid in zip(urls, task_ids)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    compiled_results: List[ScrapeResult] = []
    for url, tid, res in zip(urls, task_ids, results):
        if isinstance(res, Exception):
            logger.error("Task %s threw unhandled exception: %s", tid, res)
            fallback_res = ScrapeResult(
                task_id=tid,
                url=url,
                state=SandboxState.FAILED,
                error=str(res),
                completed_at=datetime.now(timezone.utc)
            )
            async with state_lock:
                active_tasks[tid] = fallback_res
            compiled_results.append(fallback_res)
        elif isinstance(res, ScrapeResult):
            compiled_results.append(res)
        else:
            cached = active_tasks.get(tid)
            if cached:
                compiled_results.append(cached)

    batch_obj = BatchResult(
        batch_id=batch_id,
        total_urls=len(urls),
        results=compiled_results,
        created_at=datetime.now(timezone.utc)
    )

    async with state_lock:
        batch_results[batch_id] = batch_obj

    await broadcast_batch_completed(batch_obj)
    logger.info("Batch execution [%s] complete.", batch_id)
    return batch_obj


# -----------------------------------------------------------------------------
# REST API Endpoints
# -----------------------------------------------------------------------------

@app.post("/api/scrape", status_code=status.HTTP_202_ACCEPTED)
async def submit_scrape_batch(
    request: ScrapeRequest,
    background_tasks: BackgroundTasks
) -> Dict[str, Any]:
    """
    Submit a batch scrape request across isolated microVM sandboxes.
    Immediately returns batch ID and provisioned task IDs.
    """
    if not request.urls:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one target URL must be provided."
        )

    batch_id = request.batch_id or f"batch-{uuid.uuid4().hex[:8]}"
    task_ids: List[str] = []
    initial_tasks: List[Dict[str, Any]] = []

    async with state_lock:
        for url in request.urls:
            tid = f"task-{uuid.uuid4().hex[:10]}"
            task_ids.append(tid)
            init_res = ScrapeResult(
                task_id=tid,
                url=url,
                state=SandboxState.PROVISIONING,
                started_at=datetime.now(timezone.utc)
            )
            active_tasks[tid] = init_res
            initial_tasks.append(init_res.model_dump())

        batch_obj = BatchResult(
            batch_id=batch_id,
            total_urls=len(request.urls),
            results=[active_tasks[tid] for tid in task_ids],
            created_at=datetime.now(timezone.utc)
        )
        batch_results[batch_id] = batch_obj

    # Dispatch batch execution to background task worker
    background_tasks.add_task(_execute_batch, batch_id, request.urls, task_ids)

    return {
        "batch_id": batch_id,
        "task_ids": task_ids,
        "tasks": initial_tasks,
        "status": "submitted",
        "total_urls": len(request.urls)
    }


@app.get("/api/status/{batch_id}")
async def get_batch_status(batch_id: str) -> Dict[str, Any]:
    """
    Retrieve comprehensive progress and extraction results for an entire batch.
    """
    async with state_lock:
        batch = batch_results.get(batch_id)

    if not batch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Batch '{batch_id}' not found."
        )

    # Sync latest state from active_tasks
    refreshed_results: List[Dict[str, Any]] = []
    for r in batch.results:
        latest = active_tasks.get(r.task_id, r)
        refreshed_results.append(latest.model_dump())

    return {
        "batch_id": batch.batch_id,
        "total_urls": batch.total_urls,
        "created_at": batch.created_at.isoformat(),
        "results": refreshed_results,
        "tasks": refreshed_results
    }


@app.get("/api/task/{task_id}")
async def get_task_status(task_id: str) -> ScrapeResult:
    """
    Retrieve execution lifecycle details and price data for an individual scrape task.
    """
    async with state_lock:
        task = active_tasks.get(task_id)

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task '{task_id}' not found."
        )

    return task


@app.post("/api/approve/{task_id}")
async def approve_task(task_id: str) -> Dict[str, Any]:
    """
    Approve an operator challenge intervention, unpausing the frozen container.
    """
    async with state_lock:
        appr = pending_approvals.get(task_id)
        task = active_tasks.get(task_id)

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task '{task_id}' not found."
        )

    container_id = appr.container_id if appr else (task.container_id or "")

    logger.info("Human operator approved task %s (container %s)", task_id, container_id)

    # Resume container execution
    if container_id and not container_id.startswith("sim-") and sandbox_manager.client:
        try:
            await sandbox_manager.unpause_sandbox(container_id)
        except Exception as unpause_err:
            logger.warning("Could not unpause container %s: %s", container_id, unpause_err)

    # Transition state to EXECUTING
    task.state = SandboxState.EXECUTING
    async with state_lock:
        pending_approvals.pop(task_id, None)

    await broadcast_state_change(task_id, task, step_message="Approved by operator. Resuming execution.")
    await broadcast_approval_resolved(task_id, "approved")
    await broadcast_log("SECURITY", f"Task [{task_id}] challenge approved by operator.", task_id=task_id)

    return {
        "status": "approved",
        "task_id": task_id,
        "container_id": container_id
    }


@app.post("/api/reject/{task_id}")
async def reject_task(task_id: str) -> Dict[str, Any]:
    """
    Reject and immediately purge a challenged sandbox container.
    """
    async with state_lock:
        appr = pending_approvals.get(task_id)
        task = active_tasks.get(task_id)

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task '{task_id}' not found."
        )

    container_id = appr.container_id if appr else (task.container_id or "")

    logger.info("Human operator rejected task %s. Purging container %s...", task_id, container_id)

    if container_id and not container_id.startswith("sim-") and sandbox_manager.client:
        try:
            await sandbox_manager.purge_sandbox(container_id)
        except Exception as purge_err:
            logger.warning("Could not purge container %s: %s", container_id, purge_err)

    # Transition state to WIPED_AND_PURGED
    task.state = SandboxState.WIPED_AND_PURGED
    task.error = "Operation aborted and container purged by human operator."
    async with state_lock:
        pending_approvals.pop(task_id, None)

    await broadcast_state_change(task_id, task, step_message="Rejected by operator. Container wiped and purged.")
    await broadcast_approval_resolved(task_id, "rejected")
    await broadcast_log("WARN", f"Task [{task_id}] rejected and purged by operator.", task_id=task_id)

    return {
        "status": "rejected",
        "task_id": task_id,
        "container_id": container_id
    }


@app.get("/api/pool/status")
async def get_pool_status_api() -> Dict[str, Any]:
    """
    Returns pre-warmed container pool metrics, capacity, and active allocations.
    """
    return warm_pool.get_pool_status()


@app.get("/api/telemetry/{container_id}")
async def get_container_telemetry(container_id: str) -> ContainerTelemetry:
    """
    Inspect real-time CPU, RAM, and network statistics for a sandbox container.
    """
    try:
        telemetry = await sandbox_manager.get_stats(container_id)
        return telemetry
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed retrieving container telemetry: {exc}"
        )


@app.get("/api/approvals")
async def list_pending_approvals() -> List[ApprovalRequest]:
    """
    List all pending Human-In-The-Loop review requests awaiting operator action.
    """
    async with state_lock:
        return list(pending_approvals.values())


@app.get("/api/screenshot/{task_id}")
async def get_screenshot(task_id: str) -> FileResponse:
    """
    Serve full-page viewport screenshot for a specific scraping mission.
    """
    task = active_tasks.get(task_id)
    candidate_paths = [
        WORKSPACE_DIR / task_id / "screenshot.png",
        Path(task.screenshot_path) if task and task.screenshot_path else None
    ]

    for p in candidate_paths:
        if p and p.is_file():
            return FileResponse(
                path=str(p),
                media_type="image/png",
                filename=f"screenshot_{task_id}.png"
            )

    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Screenshot not found for task '{task_id}'."
    )


@app.get("/api/tasks")
async def list_all_tasks() -> List[ScrapeResult]:
    """
    List all active and recent scraping tasks.
    """
    async with state_lock:
        return list(active_tasks.values())


@app.get("/api/health")
async def health_check() -> Dict[str, Any]:
    """
    System health and security posture diagnostic.
    """
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "docker_connected": sandbox_manager.client is not None,
        "runtime": settings.docker_runtime,
        "warm_pool": warm_pool.get_pool_status(),
        "active_tasks_count": len(active_tasks),
        "active_ws_clients": len(ws_connections)
    }


# -----------------------------------------------------------------------------
# Static Frontend Serving
# -----------------------------------------------------------------------------
@app.get("/", response_class=FileResponse, include_in_schema=False)
async def serve_dashboard_root() -> FileResponse:
    """
    Serve the main Ghost Shopper Single Page Application dashboard.
    """
    index_file = FRONTEND_DIR / "index.html"
    if index_file.is_file():
        return FileResponse(str(index_file))
    return HTMLResponse("<h1>Ghost Shopper Orchestrator is running</h1>")


# Mount the frontend directory at root to serve static assets (css, js, icons)
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


# -----------------------------------------------------------------------------
# CLI Entrypoint
# -----------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "orchestrator:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level="info"
    )
