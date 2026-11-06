"""
Tests for the live screenshot capture path in /api/search.

Real Docker is not available in this sandbox, so the "live" branch is exercised
with a fake SandboxManager that writes a genuine PNG to the shared workspace the
same way scrape.js would. That proves the plumbing end to end; it does not prove
gVisor itself, which needs the Vultr VM.
"""
import asyncio
import os
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# A real 1x1 PNG, built at import so the hex cannot be typo'd.
import struct, zlib
def _make_png():
    sig = b"\x89PNG\r\n\x1a\n"
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = zlib.compress(b"\x00\xff\x00\x00")
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", raw) + chunk(b"IEND", b"")
TINY_PNG = _make_png()

import orchestrator
from orchestrator import _capture_live_screenshot, _price_band

failures = 0
def check(label, cond, extra=""):
    global failures
    print(f"{'PASS' if cond else 'FAIL'}  {label}" + (f"  -> {extra}" if extra else ""))
    if not cond:
        failures += 1


class FakeSandboxManager:
    """Stands in for SandboxManager; writes a real PNG like scrape.js does."""

    def __init__(self, workspace, *, should_fail=False, should_timeout=False):
        self.workspace = Path(workspace)
        self.client = object()          # truthy => "Docker is available"
        self.should_fail = should_fail
        self.should_timeout = should_timeout
        self.created = []
        self.purged = []
        self.last_env = None

    async def create_sandbox(self, task_id, target_url="", batch_id="", command=None):
        if self.should_fail:
            raise RuntimeError("simulated container create failure")
        self.created.append(task_id)
        return f"fake-container-{task_id[:8]}"

    async def start_sandbox(self, container_id):
        return None

    async def purge_sandbox(self, container_id):
        self.purged.append(container_id)
        return None


class FakeApi:
    """Mimics the docker-py exec API surface _capture_live_screenshot uses."""
    def __init__(self, owner, workspace):
        self.owner = owner
        self.workspace = Path(workspace)

    def exec_create(self, container, cmd, environment, workdir):
        self.owner.last_env = environment
        return {"Id": f"exec-{container}"}

    def exec_start(self, exec_id, detach=False):
        # Emulate scrape.js producing the artifact in the shared workspace.
        task_id = self.owner.last_env["TASK_ID"]
        ws = self.owner.last_env["WORKSPACE_DIR"]
        check("container WORKSPACE_DIR is the mount point", ws == "/app/workspace", ws)
        if not self.owner.should_timeout:
            d = self.workspace / task_id
            d.mkdir(parents=True, exist_ok=True)
            (d / "screenshot.png").write_bytes(TINY_PNG)


def install_fake(orch, workspace, **kw):
    fake = FakeSandboxManager(workspace, **kw)
    fake.client = FakeApi(fake, workspace)   # create_sandbox only needs truthiness
    # create_sandbox must still work with the object() client; give it a real one.
    class _C:
        api = fake.client
    fake.client = _C()
    orch.sandbox_manager = fake
    return fake


async def main():
    tmp = tempfile.mkdtemp(prefix="gs-cap-")
    original_mgr = orchestrator.sandbox_manager
    original_ws = orchestrator.WORKSPACE_DIR
    original_settings_ws = orchestrator.settings.workspace_dir
    original_enable = orchestrator.settings.enable_live_capture
    original_timeout = orchestrator.settings.live_capture_timeout_seconds

    try:
        # --- 1. Guard rails -------------------------------------------------
        orchestrator.settings.enable_live_capture = False
        r = await _capture_live_screenshot("t-disabled", "https://amazon.com/x", Path(tmp) / "t-disabled")
        check("returns None when live capture disabled", r is None)
        orchestrator.settings.enable_live_capture = True

        orchestrator.sandbox_manager = FakeSandboxManager(tmp)
        orchestrator.sandbox_manager.client = None
        r = await _capture_live_screenshot("t-nodocker", "https://amazon.com/x", Path(tmp) / "t-nodocker")
        check("returns None when Docker unavailable", r is None)

        orchestrator.sandbox_manager = FakeSandboxManager(tmp)
        orchestrator.sandbox_manager.client = object()
        r = await _capture_live_screenshot("t-badurl", "not-a-url", Path(tmp) / "t-badurl")
        check("returns None for a non-http URL", r is None)

        # --- 2. Successful live capture -------------------------------------
        orchestrator.settings.live_capture_timeout_seconds = 15
        fake = install_fake(orchestrator, tmp)
        out = await _capture_live_screenshot("t-live", "https://www.amazon.com/dp/B0TEST", Path(tmp) / "t-live")

        check("live capture returns a path", out is not None, str(out))
        check("artifact is screenshot.png", out is not None and out.name == "screenshot.png")
        check("artifact exists on disk", out is not None and out.is_file())
        check("artifact is a real PNG", out is not None and out.read_bytes()[:8] == TINY_PNG[:8])
        check("sandbox was created", len(fake.created) == 1, str(fake.created))
        check("sandbox was purged after capture", len(fake.purged) == 1, str(fake.purged))
        check("TARGET_URL passed to the worker",
              fake.last_env and fake.last_env.get("TARGET_URL") == "https://www.amazon.com/dp/B0TEST",
              fake.last_env.get("TARGET_URL") if fake.last_env else "no env")
        check("TASK_ID passed to the worker", fake.last_env and fake.last_env.get("TASK_ID") == "t-live")

        # --- 3. Failure falls back to None, still purges ---------------------
        fake = install_fake(orchestrator, tmp, should_fail=True)
        out = await _capture_live_screenshot("t-fail", "https://www.amazon.com/dp/X", Path(tmp) / "t-fail")
        check("returns None when container creation fails", out is None)
        check("no artifact written on failure", not (Path(tmp) / "t-fail" / "screenshot.png").exists())

        # --- 4. Timeout purges the container ---------------------------------
        orchestrator.settings.live_capture_timeout_seconds = 2
        fake = install_fake(orchestrator, tmp, should_timeout=True)
        out = await _capture_live_screenshot("t-timeout", "https://www.amazon.com/dp/Y", Path(tmp) / "t-timeout")
        check("returns None on timeout", out is None)
        check("container still purged after timeout", len(fake.purged) == 1, str(fake.purged))
        orchestrator.settings.live_capture_timeout_seconds = 15

    finally:
        orchestrator.sandbox_manager = original_mgr
        orchestrator.WORKSPACE_DIR = original_ws
        orchestrator.settings.workspace_dir = original_settings_ws
        orchestrator.settings.enable_live_capture = original_enable
        orchestrator.settings.live_capture_timeout_seconds = original_timeout
        shutil.rmtree(tmp, ignore_errors=True)

    # --- 5. Settings propagation ------------------------------------------
    check("settings.workspace_dir is resolved (not /app/workspace)",
          orchestrator.settings.workspace_dir == str(orchestrator.WORKSPACE_DIR),
          orchestrator.settings.workspace_dir)
    check("resolved workspace is not the container default",
          orchestrator.settings.workspace_dir != "/app/workspace",
          orchestrator.settings.workspace_dir)

    print()
    print("ALL PASSED" if failures == 0 else f"{failures} CHECK(S) FAILED")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
