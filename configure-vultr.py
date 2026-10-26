#!/usr/bin/env python3
"""
Ghost Shopper — Vultr Credential Setup & Configuration Utility
==============================================================
Designed for easy onboarding when Vultr Hackathon credits are issued on November 3rd.

Usage:
    python configure-vultr.py
"""

import os
import sys
from pathlib import Path

# Ensure Windows terminal compatibility with UTF-8
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"
ENV_EXAMPLE = BASE_DIR / ".env.example"


def print_banner():
    print("\033[96m" + "=" * 65 + "\033[0m")
    print("\033[96m   🔮 GHOST SHOPPER — VULTR CREDENTIAL CONFIGURATOR (NOV 3)   \033[0m")
    print("\033[96m" + "=" * 65 + "\033[0m")
    print("Use this tool to plug in your Vultr credits & API keys on November 3rd.")
    print("All credentials are saved locally to .env (which is git-ignored).\n")


def load_existing_env():
    env_vars = {}
    if ENV_FILE.is_file():
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env_vars[k.strip()] = v.strip().strip("'\"")
    elif ENV_EXAMPLE.is_file():
        with open(ENV_EXAMPLE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env_vars[k.strip()] = v.strip().strip("'\"")
    return env_vars


def save_env(env_vars):
    template = f"""# =============================================================================
# Ghost Shopper Configuration (.env)
# Configured for Vultr Hackathon Infrastructure
# =============================================================================

GHOST_SHOPPER_ENV={env_vars.get('GHOST_SHOPPER_ENV', 'production')}
DOCKER_HOST={env_vars.get('DOCKER_HOST', 'unix:///var/run/docker.sock')}

# Pre-Warmed Pool Configuration
WARM_POOL_SIZE={env_vars.get('WARM_POOL_SIZE', '3')}
WARM_POOL_MAX={env_vars.get('WARM_POOL_MAX', '5')}

# Sandbox Resource Caps (Blast Radius Zero)
SANDBOX_CPU_LIMIT={env_vars.get('SANDBOX_CPU_LIMIT', '1.0')}
SANDBOX_MEMORY_LIMIT={env_vars.get('SANDBOX_MEMORY_LIMIT', '512m')}
SANDBOX_TIMEOUT_SECONDS={env_vars.get('SANDBOX_TIMEOUT_SECONDS', '60')}

# Hypervisor Runtime
DOCKER_RUNTIME={env_vars.get('DOCKER_RUNTIME', 'runsc')}

# Vultr Cloud Compute API (For VM Deployment)
VULTR_API_KEY={env_vars.get('VULTR_API_KEY', '')}

# Vultr Serverless Inference (Tier-2 AI Price & Anomaly Audit)
VULTR_INFERENCE_API_KEY={env_vars.get('VULTR_INFERENCE_API_KEY', '')}
VULTR_INFERENCE_ENDPOINT={env_vars.get('VULTR_INFERENCE_ENDPOINT', 'https://api.vultrinference.com/v1/chat/completions')}
VULTR_VISION_MODEL={env_vars.get('VULTR_VISION_MODEL', 'llama-3.2-90b-vision-preview')}

# Network Security (Blocked Subnets & Cloud Metadata)
BLOCKED_SUBNETS={env_vars.get('BLOCKED_SUBNETS', '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.169.254/32')}

# Storage Workspace
WORKSPACE_DIR={env_vars.get('WORKSPACE_DIR', '/app/workspace')}
GHOST_NETWORK={env_vars.get('GHOST_NETWORK', 'ghost-net')}
SANDBOX_IMAGE={env_vars.get('SANDBOX_IMAGE', 'ghost-shopper-sandbox:latest')}
"""
    with open(ENV_FILE, "w", encoding="utf-8") as f:
        f.write(template)
    print(f"\033[92m[OK] Configuration saved successfully to {ENV_FILE}\033[0m")


def main():
    print_banner()
    env = load_existing_env()

    current_vultr_key = env.get("VULTR_API_KEY", "")
    current_inf_key = env.get("VULTR_INFERENCE_API_KEY", "")

    print("1. \033[1mVultr Cloud Account API Key\033[0m (For provisioning Cloud Compute instances)")
    print("   Find this at: https://my.vultr.com/settings/#settingsapi")
    if current_vultr_key:
        masked = current_vultr_key[:4] + "..." + current_vultr_key[-4:] if len(current_vultr_key) > 8 else "***"
        print(f"   Current: {masked}")
    vultr_key = input("   Enter Vultr API Key [Press Enter to keep current]: ").strip()
    if vultr_key:
        env["VULTR_API_KEY"] = vultr_key

    print("\n2. \033[1mVultr Serverless Inference Key\033[0m (For Llama 3.2 Vision tier-2 audits)")
    print("   Find this at: https://my.vultr.com/inference/ (or use same account key if shared)")
    if current_inf_key:
        masked = current_inf_key[:4] + "..." + current_inf_key[-4:] if len(current_inf_key) > 8 else "***"
        print(f"   Current: {masked}")
    inf_key = input("   Enter Vultr Inference Key [Press Enter to keep current]: ").strip()
    if inf_key:
        env["VULTR_INFERENCE_API_KEY"] = inf_key

    print("\n3. \033[1mVision Model Name\033[0m")
    current_model = env.get("VULTR_VISION_MODEL", "llama-3.2-90b-vision-preview")
    print(f"   Default: {current_model}")
    model_choice = input("   Enter Model Name [Press Enter to accept default]: ").strip()
    if model_choice:
        env["VULTR_VISION_MODEL"] = model_choice

    print("\nSaving configuration...")
    save_env(env)

    print("\n\033[96mNext Steps:\033[0m")
    print("  1. Verify credentials:  \033[93mpython test-vultr.py\033[0m")
    print("  2. Run local dashboard: \033[93mpython orchestrator.py\033[0m")
    print("  3. Deploy to Vultr VM:  \033[93m./scripts/deploy-vultr.sh\033[0m\n")


if __name__ == "__main__":
    main()
