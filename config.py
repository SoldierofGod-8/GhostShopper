"""
Configuration module for Ghost Shopper.

Provides centralized application settings loaded from environment variables
and an optional .env file using pydantic-settings.
"""

from functools import lru_cache
import os
import re
from typing import List, Optional

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
    from pydantic import Field, field_validator
    _V2 = True
except ImportError:
    # Pydantic v1 fallback compatibility
    from pydantic import BaseSettings, Field, validator as field_validator  # type: ignore
    _V2 = False


class Settings(BaseSettings):
    """
    Application settings for the Ghost Shopper backend.
    
    Attributes:
        env: Runtime environment mode ('production', 'development', 'testing').
        docker_host: Docker daemon connection URI (Unix socket or TCP address).
        warm_pool_size: Target baseline count of pre-warmed sandbox containers.
        warm_pool_max: Maximum permissible concurrent sandbox containers.
        sandbox_cpu_limit: Maximum CPU core quota allocated to each sandbox.
        sandbox_memory_limit: Maximum RAM limit string for each sandbox (e.g. '512m').
        sandbox_timeout_seconds: Execution watchdog timeout in seconds.
        docker_runtime: Docker OCI runtime engine (e.g. 'runsc' for gVisor).
        vultr_api_key: Vultr Cloud account API key used to provision Cloud Compute instances.
        vultr_inference_api_key: API authorization key for Vultr Serverless Inference.
        vultr_inference_endpoint: Target URL for Vultr inference chat completions.
        vultr_vision_model: Vision LLM model identifier used for Tier-2 price verification.
        blocked_subnets: Comma-separated list of IPv4 CIDR blocks restricted from container egress.
        workspace_dir: Host/container mount path for task workspace files.
        sandbox_image: Docker image tag for running the Playwright/Chromium scraper.
        ghost_network: Docker bridge network name isolated for sandbox containers.
    """

    env: str = Field(
        default="production",
        description="Environment name: production, development, or testing"
    )
    docker_host: str = Field(
        default="unix:///var/run/docker.sock",
        description="Docker daemon connection socket or URL"
    )
    warm_pool_size: int = Field(
        default=3,
        ge=0,
        description="Target number of pre-warmed idle sandboxes in the pool"
    )
    warm_pool_max: int = Field(
        default=5,
        ge=1,
        description="Maximum upper limit of concurrent sandboxes permitted"
    )
    sandbox_cpu_limit: float = Field(
        default=1.0,
        gt=0.0,
        description="CPU limit allocated to each sandbox container"
    )
    sandbox_memory_limit: str = Field(
        default="512m",
        description="Memory limit for container, e.g. 512m or 1g"
    )
    sandbox_timeout_seconds: int = Field(
        default=60,
        gt=0,
        description="Watchdog timeout after which container execution is terminated"
    )
    docker_runtime: str = Field(
        default="runsc",
        description="Docker runtime engine (e.g. runsc for gVisor sandboxing)"
    )
    vultr_api_key: str = Field(
        default="",
        description="Vultr Cloud account API key (used to provision Cloud Compute instances)"
    )
    vultr_inference_api_key: str = Field(
        default="",
        description="Vultr Serverless Inference API key"
    )
    vultr_inference_endpoint: str = Field(
        default="https://api.vultrinference.com/v1/chat/completions",
        description="Vultr inference chat completions API endpoint"
    )
    vultr_vision_model: str = Field(
        default="llama-3.2-90b-vision-preview",
        description="Vultr vision LLM model name for price verification"
    )
    blocked_subnets: str = Field(
        default="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16,127.0.0.0/8,100.64.0.0/10",
        description="Comma-separated IPv4 subnets blocked from container egress"
    )
    workspace_dir: str = Field(
        default="/app/workspace",
        description="Directory path for sandbox shared workspace"
    )
    sandbox_image: str = Field(
        default="ghost-shopper-sandbox:latest",
        description="Docker image tag used for scraping sandboxes"
    )
    ghost_network: str = Field(
        default="ghost-net",
        description="Docker network name used for sandbox isolation"
    )

    if _V2:
        model_config = SettingsConfigDict(
            env_file=".env",
            env_file_encoding="utf-8",
            extra="ignore",
            case_sensitive=False
        )
    else:
        class Config:
            env_file = ".env"
            env_file_encoding = "utf-8"
            extra = "ignore"
            case_sensitive = False

    @property
    def parsed_blocked_subnets(self) -> List[str]:
        """
        Return the list of blocked subnets parsed from the comma-separated string.
        """
        if not self.blocked_subnets:
            return []
        return [subnet.strip() for subnet in self.blocked_subnets.split(",") if subnet.strip()]

    @property
    def nano_cpus(self) -> int:
        """
        Convert the floating-point CPU limit into Docker's integer nano_cpus representation.
        """
        return int(self.sandbox_cpu_limit * 1_000_000_000)

    @property
    def memory_limit_bytes(self) -> int:
        """
        Convert human-readable memory limit string (e.g., '512m', '1g') to bytes.
        """
        val_str = self.sandbox_memory_limit.strip().lower()
        match = re.match(r"^(\d+)([kmg]?)$", val_str)
        if not match:
            # Default fallback to 512MB
            return 512 * 1024 * 1024
        
        number, unit = int(match.group(1)), match.group(2)
        multipliers = {
            "": 1,
            "k": 1024,
            "m": 1024 * 1024,
            "g": 1024 * 1024 * 1024
        }
        return number * multipliers.get(unit, 1024 * 1024)


@lru_cache()
def get_settings() -> Settings:
    """
    Retrieve cached application settings singleton.
    
    Returns:
        Settings: Initialized configuration instance.
    """
    return Settings()
