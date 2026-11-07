"""Proves _ensure_task_dir lets a second, unrelated UID write into the task dir.

This reproduces the deployed failure:

    PermissionError: [Errno 13] Permission denied: '/app/workspace/task-search-...'

The orchestrator creates the task directory inside the host bind mount, then the
sandbox container - running as a different UID - writes screenshot.png into it.
A plain mkdir leaves that directory owned by the orchestrator with mode 0755, so
the sandbox is refused.

Run as root inside this container so a genuine second UID can be simulated:
    setpriv --reuid=<uid> --regid=<gid> --clear-groups <cmd>
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, "/home/user/GhostShopper")

import orchestrator as o

failures = 0


def check(name, cond, extra=""):
    global failures
    if cond:
        print(f"PASS  {name}" + (f"  -> {extra}" if extra else ""))
    else:
        failures += 1
        print(f"FAIL  {name}" + (f"  -> {extra}" if extra else ""))


def write_as_other_uid(directory, uid, gid):
    """Try to create a file in `directory` as uid:gid. Returns (ok, stderr)."""
    target = str(Path(directory) / "screenshot.png")
    proc = subprocess.run(
        ["setpriv", f"--reuid={uid}", f"--regid={gid}", "--clear-groups",
         "/bin/sh", "-c", f"echo png > {target!r}"],
        capture_output=True, text=True,
    )
    return proc.returncode == 0 and Path(target).exists(), proc.stderr.strip()


root = Path(tempfile.mkdtemp(prefix="ws-"))
# Simulate the bind mount: a directory owned by "root" that the orchestrator's
# UID (1000 here) must create task dirs inside.
os.chmod(root, 0o755)

# --- Case 1: the old behaviour, plain mkdir --------------------------------
old_dir = root / "task-plain-mkdir"
old_dir.mkdir(parents=True, exist_ok=True)
ok, err = write_as_other_uid(old_dir, uid=12345, gid=12345)
check("plain mkdir (old behaviour) BLOCKS a foreign UID", not ok,
      err.splitlines()[-1][:60] if err else "unexpectedly succeeded")

# --- Case 2: the fix -------------------------------------------------------
new_dir = root / "task-ensured"
o._ensure_task_dir(new_dir)
ok, err = write_as_other_uid(new_dir, uid=12345, gid=12345)
check("_ensure_task_dir ALLOWS a foreign UID to write", ok, err[:60] if err else "wrote ok")

# --- Case 3: mode is what we claim -----------------------------------------
mode = oct(new_dir.stat().st_mode & 0o777)
check("task dir mode is 0o777", mode == "0o777", mode)

# --- Case 4: parents are created too ---------------------------------------
nested = root / "deep" / "nested" / "task-nested"
o._ensure_task_dir(nested)
ok, err = write_as_other_uid(nested, uid=12345, gid=12345)
check("parents are created and writable", ok, err[:60] if err else "wrote ok")

# --- Case 5: idempotent, and chmod tolerates an existing dir ---------------
o._ensure_task_dir(new_dir)  # must not raise
check("re-running is idempotent", (new_dir / "screenshot.png").exists())

# --- Case 6: the shared root gets the sticky bit ---------------------------
sticky_root = root / "shared-root"
sticky_root.mkdir(parents=True, exist_ok=True)
o._ensure_task_dir(sticky_root, mode=o.WORKSPACE_ROOT_MODE)
check("shared root mode is 0o1777",
      oct(sticky_root.stat().st_mode & 0o1777) == "0o1777",
      oct(sticky_root.stat().st_mode & 0o1777))

# --- Case 7: sticky bit stops one sandbox deleting another's directory -----
# UID 12345 owns victim-task; UID 54321 must not be able to rmdir it.
victim = sticky_root / "task-victim"
victim.mkdir()
os.chown(victim, 12345, 12345)
proc = subprocess.run(
    ["setpriv", "--reuid=54321", "--regid=54321", "--clear-groups",
     "rmdir", str(victim)],
    capture_output=True, text=True,
)
check("sticky bit BLOCKS one sandbox deleting another's task dir",
      proc.returncode != 0 and victim.exists(),
      proc.stderr.strip().splitlines()[-1][:60] if proc.stderr.strip() else "succeeded")

print()
print("ALL PASSED" if failures == 0 else f"{failures} CHECK(S) FAILED")
sys.exit(1 if failures else 0)
