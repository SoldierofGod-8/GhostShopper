"""Reproduces the vanished-task-directory failure and proves the fix.

Deployed symptom:

    FileNotFoundError: [Errno 2] No such file or directory:
        '/app/workspace/task-search-amazon-a16a0f'

The task directory is created at the start of a search and written into at the
end of it. In between, the capture step runs for tens of seconds against a bind
mount shared with the sandbox and the host. If the directory is gone by the time
the write happens, the plain open() raises and the whole search fails even
though nothing was wrong with the search.
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, "/home/user/GhostShopper")

# Importing orchestrator creates its workspace at import time. Run under sudo
# that would be /app/workspace as root, which then breaks other tests (the
# resolver happily uses it, and nothing else can write there). Pin it to a
# scratch directory so this test is self-contained regardless of who runs it.
os.environ.setdefault(
    "WORKSPACE_DIR",
    os.path.join("/tmp", "ghost-shopper-test-" + os.path.basename(__file__).replace(".py", "")),
)

import orchestrator as o

failures = 0


def check(name, cond, extra=""):
    global failures
    if cond:
        print(f"PASS  {name}" + (f"  -> {extra}" if extra else ""))
    else:
        failures += 1
        print(f"FAIL  {name}" + (f"  -> {extra}" if extra else ""))


async def main():
    root = Path(tempfile.mkdtemp(prefix="ws-gone-"))
    # mkdtemp uses 0700, which a foreign UID cannot even traverse into.
    # Stand in for the real workspace root, which is created 0o1777.
    root.chmod(0o1777)

    # --- Case 1: reproduce the deployed error with a plain open() ----------
    gone = root / "task-search-amazon-a16a0f"
    gone.mkdir(parents=True)
    gone.rmdir()  # the directory vanishes between create and write
    try:
        with open(str(gone / "output.json"), "w") as f:
            f.write("{}")
        plain_ok, plain_err = True, ""
    except FileNotFoundError as exc:
        plain_ok, plain_err = False, exc.strerror
    check("plain open() FAILS on a vanished task dir", not plain_ok, plain_err)

    # --- Case 2: _async_write_text recovers -------------------------------
    await o._async_write_text(gone / "output.json", '{"ok": true}')
    check("_async_write_text re-creates the dir and writes",
          (gone / "output.json").is_file(),
          (gone / "output.json").read_text() if (gone / "output.json").is_file() else "missing")

    # --- Case 3: same for the binary helper -------------------------------
    gone2 = root / "task-search-bestbuy-b27b1a"
    await o._async_write_bytes(gone2 / "screenshot.png", b"\x89PNG\r\n\x1a\n")
    check("_async_write_bytes re-creates the dir and writes",
          (gone2 / "screenshot.png").is_file())

    # --- Case 4: parents, not just the leaf -------------------------------
    deep = root / "a" / "b" / "c" / "output.json"
    await o._async_write_text(deep, "deep")
    check("missing parent chain is created", deep.is_file())

    # --- Case 5: a re-created dir is still sandbox-writable ---------------
    # The host wiped the directory, so the permissions we set earlier are gone
    # too. Writing must not silently leave it unreadable by the next sandbox.
    import subprocess
    o._ensure_task_dir(gone)
    proc = subprocess.run(
        ["setpriv", "--reuid=12345", "--regid=12345", "--clear-groups",
         "/bin/sh", "-c", f"echo x > {str(gone / 'probe.png')!r}"],
        capture_output=True, text=True,
    )
    check("re-created dir is writable by a foreign UID",
          proc.returncode == 0, proc.stderr.strip()[:60] or "wrote ok")

    print()
    print("ALL PASSED" if failures == 0 else f"{failures} CHECK(S) FAILED")
    return 1 if failures else 0


sys.exit(asyncio.run(main()))
