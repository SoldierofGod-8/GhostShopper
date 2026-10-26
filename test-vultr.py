#!/usr/bin/env python3
"""
Ghost Shopper — Vultr Credential & Infrastructure Diagnostic Tool
=================================================================
Validates Vultr API keys, Serverless Inference access, and container runtime.
Run this script on November 3rd once credits and credentials are issued.

Usage:
    python test-vultr.py
"""

import os
import sys
from pathlib import Path
import httpx

# Ensure Windows terminal compatibility with UTF-8
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Load .env file manually if python-dotenv is present, or parse directly
BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"

GREEN = "\033[92m"
CYAN = "\033[96m"
YELLOW = "\033[93m"
RED = "\033[91m"
BOLD = "\033[1m"
RESET = "\033[0m"


def load_env():
    env = {}
    if ENV_FILE.is_file():
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip("'\"")
    return env


def test_vultr_account_api(api_key: str):
    print(f"\n{BOLD}[1/3] Testing Vultr Cloud Compute API Key...{RESET}")
    if not api_key or api_key == "your_vultr_api_key_here":
        print(f"  {YELLOW}⚠ VULTR_API_KEY is not set in .env{RESET}")
        print(f"    (Expected until Nov 3rd credits arrive. Run 'python configure-vultr.py' once received.)")
        return False

    try:
        url = "https://api.vultr.com/v2/account"
        headers = {"Authorization": f"Bearer {api_key}"}
        resp = httpx.get(url, headers=headers, timeout=10.0)

        if resp.status_code == 200:
            data = resp.json().get("account", {})
            name = data.get("name") or "Vultr User"
            email = data.get("email") or "N/A"
            balance = data.get("balance", "N/A")
            pending = data.get("pending_charges", "N/A")
            print(f"  {GREEN}✓ Vultr Account API: CONNECTED!{RESET}")
            print(f"    • Account: {name} ({email})")
            print(f"    • Current Balance: ${balance} (Pending: ${pending})")
            return True
        elif resp.status_code == 401:
            print(f"  {RED}✗ Authentication Failed (HTTP 401): Invalid VULTR_API_KEY.{RESET}")
            return False
        else:
            print(f"  {RED}✗ Vultr API Error: HTTP {resp.status_code} - {resp.text}{RESET}")
            return False
    except Exception as e:
        print(f"  {RED}✗ Connection failed: {e}{RESET}")
        return False


def test_vultr_inference_api(inf_key: str, endpoint: str, model: str):
    print(f"\n{BOLD}[2/3] Testing Vultr Serverless Inference (Vision LLM)...{RESET}")
    if not inf_key or inf_key == "your_vultr_api_key_here":
        print(f"  {YELLOW}⚠ VULTR_INFERENCE_API_KEY is not set in .env{RESET}")
        print(f"    (Tier-2 verification will gracefully use deterministic regex fallback until Nov 3rd.)")
        return False

    try:
        headers = {
            "Authorization": f"Bearer {inf_key}",
            "Content-Type": "application/json"
        }
        # Lightweight ping to the completions endpoint
        payload = {
            "model": model,
            "messages": [
                {"role": "user", "content": "Respond with the word 'OK' only."}
            ],
            "max_tokens": 5
        }
        resp = httpx.post(endpoint, headers=headers, json=payload, timeout=15.0)

        if resp.status_code == 200:
            data = resp.json()
            reply = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
            print(f"  {GREEN}✓ Vultr Serverless Inference: CONNECTED!{RESET}")
            print(f"    • Model: {model}")
            print(f"    • Test Response: '{reply}'")
            return True
        elif resp.status_code == 401:
            print(f"  {RED}✗ Authentication Failed (HTTP 401): Invalid VULTR_INFERENCE_API_KEY.{RESET}")
            return False
        else:
            print(f"  {YELLOW}⚠ Endpoint returned HTTP {resp.status_code}: {resp.text[:120]}{RESET}")
            return False
    except Exception as e:
        print(f"  {RED}✗ Connection failed: {e}{RESET}")
        return False


def test_local_docker_and_gvisor():
    print(f"\n{BOLD}[3/3] Checking Container Hypervisor (gVisor / Docker)...{RESET}")
    try:
        import docker
        client = docker.from_env()
        client.ping()
        print(f"  {GREEN}✓ Docker Daemon: ONLINE{RESET}")

        # Check for runsc runtime
        info = client.info()
        runtimes = info.get("Runtimes", {})
        if "runsc" in runtimes:
            print(f"  {GREEN}✓ gVisor (runsc) Runtime: INSTALLED & REGISTERED{RESET}")
        else:
            print(f"  {YELLOW}ℹ gVisor runtime 'runsc' not found locally.{RESET}")
            print(f"    (Normal on Windows/Mac. On your Vultr Linux VM, run './scripts/setup-gvisor.sh' to enable.)")
        return True
    except ImportError:
        print(f"  {YELLOW}ℹ 'docker' python library not found in current virtualenv.{RESET}")
        print(f"    (Orchestrator will run in high-fidelity local simulation mode.)")
        return False
    except Exception as e:
        print(f"  {YELLOW}ℹ Docker host not reachable ({e}).{RESET}")
        print(f"    (Orchestrator will run in simulation mode. Fully operational for local testing!)")
        return False


def main():
    print(f"{CYAN}{'=' * 65}{RESET}")
    print(f"{CYAN}   🔮 GHOST SHOPPER — INFRASTRUCTURE READINESS CHECK          {RESET}")
    print(f"{CYAN}{'=' * 65}{RESET}")

    env = load_env()
    vultr_key = env.get("VULTR_API_KEY", "")
    inf_key = env.get("VULTR_INFERENCE_API_KEY", "")
    endpoint = env.get("VULTR_INFERENCE_ENDPOINT", "https://api.vultrinference.com/v1/chat/completions")
    model = env.get("VULTR_VISION_MODEL", "llama-3.2-90b-vision-preview")

    res_account = test_vultr_account_api(vultr_key)
    res_inf = test_vultr_inference_api(inf_key, endpoint, model)
    res_docker = test_local_docker_and_gvisor()

    print(f"\n{CYAN}{'=' * 65}{RESET}")
    print(f"{BOLD}DIAGNOSTIC SUMMARY:{RESET}")
    if res_account and res_inf:
        print(f"{GREEN}✓ ALL VULTR CREDENTIALS VERIFIED & LIVE! Ready for cloud execution.{RESET}")
    else:
        print(f"{YELLOW}ℹ Running in Local / Pre-Hackathon Mode.{RESET}")
        print(f"  • System is 100% testable right now with local simulation.")
        print(f"  • When credits arrive on Nov 3rd, run: {BOLD}python configure-vultr.py{RESET}")
    print(f"{CYAN}{'=' * 65}{RESET}\n")


if __name__ == "__main__":
    main()
