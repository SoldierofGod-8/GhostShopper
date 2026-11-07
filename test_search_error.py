"""Proves the /api/search wrapper converts a crash into a displayable JSON error.

Without it, an unhandled exception leaves the browser showing a generic
"Search request failed" with no indication of the real cause.
"""
import sys

sys.path.insert(0, "/home/user/GhostShopper")

import orchestrator as o
from fastapi.testclient import TestClient

failures = 0


def check(name, cond, extra=""):
    global failures
    if cond:
        print(f"PASS  {name}" + (f"  -> {extra}" if extra else ""))
    else:
        failures += 1
        print(f"FAIL  {name}" + (f"  -> {extra}" if extra else ""))


client = TestClient(o.app, raise_server_exceptions=False)

# 1. Baseline - a normal search must still work through the new wrapper.
r = client.post("/api/search", json={"query": "Sony WH-1000XM5", "stores": ["Amazon"]})
check("normal search still returns 200", r.status_code == 200, f"HTTP {r.status_code}")
check("normal search still returns JSON",
      r.headers.get("content-type", "").startswith("application/json"),
      r.headers.get("content-type", ""))

# 2. Force the implementation to blow up; the wrapper must convert it.
async def boom(request):
    raise RuntimeError("simulated failure inside search")


o._search_competitor_prices_impl = boom

r = client.post("/api/search", json={"query": "Sony WH-1000XM5", "stores": ["Amazon"]})
check("crashing search returns 500 rather than dropping", r.status_code == 500,
      f"HTTP {r.status_code}")
check("error body is JSON", r.headers.get("content-type", "").startswith("application/json"),
      r.headers.get("content-type", ""))

try:
    body = r.json()
    parsed = True
except Exception:
    body, parsed = {}, False
check("error body parses as JSON", parsed)
check("detail names the exception type", "RuntimeError" in str(body.get("detail", "")),
      str(body.get("detail"))[:70])
check("detail carries the real message",
      "simulated failure inside search" in str(body.get("detail", "")))

print()
print("ALL PASSED" if failures == 0 else f"{failures} CHECK(S) FAILED")
sys.exit(1 if failures else 0)
