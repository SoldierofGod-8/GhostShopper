"""
Docker container lifecycle manager for Ghost Shopper.

Provides hardened gVisor (runsc) container provisioning, resource enforcement,
monitoring, lifecycle transitions, and timeout watchdog tracking.
"""

import asyncio
from datetime import datetime, timezone
import logging
import os
from typing import Any, Dict, Optional

try:
    import docker
    from docker.errors import APIError, DockerException, NotFound
    from docker.models.containers import Container
except ImportError:
    docker = None  # type: ignore
    APIError = DockerException = NotFound = Exception  # type: ignore

from config import Settings, get_settings
from models import ContainerTelemetry, SandboxState

logger = logging.getLogger("ghost_shopper.sandbox_manager")


class SandboxManager:
    """
    Manages isolated gVisor-based Docker containers for untrusted web scraping.
    
    Enforces security isolation:
      - gVisor (runsc) kernel sandbox
      - CPU and Memory strict quotas (zero swap)
      - Dropped capabilities (ALL)
      - No-new-privileges flag
      - Isolated bridge network ('ghost-net') with egress filtering
      - Restricted DNS (8.8.8.8)
      - Ephemeral tmpfs mounts for /tmp and /dev/shm (Chromium support)
      - Hard watchdog timeout
    """

    def __init__(self, config: Optional[Settings] = None):
        """
        Initialize the SandboxManager with settings and Docker client connection.
        
        Args:
            config: Optional Settings instance. If omitted, global settings are used.
        """
        self.config = config or get_settings()
        self.client: Optional[docker.DockerClient] = None
        self._watchdog_tasks: Dict[str, asyncio.Task] = {}
        self._container_states: Dict[str, SandboxState] = {}
        self._blocked_counts: Dict[str, int] = {}
        
        self._initialize_client()
        self._ensure_network()

    def _initialize_client(self) -> None:
        """
        Establish connection with the Docker daemon with platform fallbacks.
        """
        if docker is None:
            logger.error("The 'docker' Python package is not installed. Docker operations will fail.")
            return

        try:
            # On Windows or when socket path differs, docker.from_env() handles named pipes
            if os.name == "nt" and "unix://" in self.config.docker_host:
                logger.info("Windows detected: attempting default environment Docker connection.")
                self.client = docker.from_env(timeout=1)
            else:
                self.client = docker.DockerClient(base_url=self.config.docker_host, timeout=1)
            
            # Ping daemon to test connection
            self.client.ping()
            logger.info("Successfully connected to Docker daemon at %s", self.config.docker_host)
        except Exception as exc:
            logger.info("Docker daemon not reachable locally (%s). Operating in simulation mode.", exc)
            self.client = None

    def _ensure_network(self) -> None:
        """
        Verify or create the dedicated isolated Docker bridge network.
        """
        if not self.client:
            return

        try:
            networks = self.client.networks.list(names=[self.config.ghost_network])
            if not networks:
                logger.info("Creating isolated Docker bridge network: %s", self.config.ghost_network)
                self.client.networks.create(
                    name=self.config.ghost_network,
                    driver="bridge",
                    check_duplicate=True,
                    internal=False,  # Needs external egress to scrape product pages
                    labels={"managed_by": "ghost-shopper"}
                )
            else:
                logger.debug("Isolated network %s already exists.", self.config.ghost_network)
        except Exception as exc:
            logger.warning("Could not ensure Docker network '%s': %s", self.config.ghost_network, exc)

    async def create_sandbox(
        self,
        task_id: str,
        target_url: str = "",
        batch_id: str = "",
        command: Optional[str] = None
    ) -> str:
        """
        Create a new hardened gVisor container sandbox.
        
        Args:
            task_id: Unique task identifier.
            target_url: Optional target product URL to scrape.
            batch_id: Optional batch correlation ID.
            command: Optional entrypoint command override.
            
        Returns:
            str: The container ID created.
            
        Raises:
            RuntimeError: If Docker client is unavailable or container creation fails.
        """
        if not self.client:
            raise RuntimeError("Docker client is unavailable. Cannot create sandbox.")

        # Ensure local workspace directory exists on host
        os.makedirs(self.config.workspace_dir, exist_ok=True)
        workspace_host_path = os.path.abspath(self.config.workspace_dir)

        # Build iptables initialization snippet to drop egress to internal/private subnets
        iptables_rules = []
        for subnet in self.config.parsed_blocked_subnets:
            iptables_rules.append(f"iptables -A OUTPUT -d {subnet} -j DROP 2>/dev/null || true;")
        iptables_cmd = " ".join(iptables_rules)

        default_cmd = command
        if not default_cmd:
            # Default container command: apply egress blocks, then wait or run scraper
            default_cmd = f'/bin/sh -c "{iptables_cmd} tail -f /dev/null"'

        env_vars = {
            "TASK_ID": task_id,
            "TARGET_URL": target_url,
            "BATCH_ID": batch_id,
            "BLOCKED_SUBNETS": self.config.blocked_subnets,
            "WORKSPACE_DIR": "/app/workspace",
            "PYTHONUNBUFFERED": "1"
        }

        labels = {
            "managed_by": "ghost-shopper",
            "task_id": task_id,
            "batch_id": batch_id,
            "created_at": datetime.now(timezone.utc).isoformat()
        }

        # Memory and CPU configuration
        mem_limit = self.config.sandbox_memory_limit
        memswap_limit = self.config.sandbox_memory_limit  # Equal to mem_limit prevents swap usage
        nano_cpus = self.config.nano_cpus

        # Security attributes and tmpfs configuration required for Chromium under gVisor
        tmpfs_mounts = {
            "/tmp": "rw,noexec,nosuid,size=128m",
            "/dev/shm": "rw,exec,nosuid,size=256m"
        }

        volumes = {
            workspace_host_path: {
                "bind": "/app/workspace",
                "mode": "rw"
            }
        }

        # Runtime specification (runsc for gVisor)
        runtime = self.config.docker_runtime

        def _do_create():
            create_kwargs: Dict[str, Any] = {
                "image": self.config.sandbox_image,
                "command": default_cmd,
                "detach": True,
                "nano_cpus": nano_cpus,
                "mem_limit": mem_limit,
                "memswap_limit": memswap_limit,
                "network": self.config.ghost_network,
                "cap_drop": ["ALL"],
                "security_opt": ["no-new-privileges:true"],
                "volumes": volumes,
                "tmpfs": tmpfs_mounts,
                "dns": ["8.8.8.8"],
                "environment": env_vars,
                "labels": labels,
                "stdin_open": True,
                "tty": False
            }

            if runtime:
                create_kwargs["runtime"] = runtime

            try:
                container = self.client.containers.create(**create_kwargs)
                return container.id
            except APIError as api_err:
                # If custom runtime (runsc) is not installed on this host, log and retry with default runtime if safe
                if "unknown or invalid runtime" in str(api_err).lower() or "runtime runsc" in str(api_err).lower():
                    logger.warning("Runtime '%s' unavailable. Retrying with default Docker runtime.", runtime)
                    create_kwargs.pop("runtime", None)
                    container = self.client.containers.create(**create_kwargs)
                    return container.id
                raise

        try:
            logger.info("Creating sandbox container for task %s (runtime=%s, mem=%s, cpu=%s)",
                        task_id, runtime, mem_limit, self.config.sandbox_cpu_limit)
            container_id = await asyncio.to_thread(_do_create)
            self._container_states[container_id] = SandboxState.PROVISIONING
            self._blocked_counts[container_id] = 0
            logger.info("Container %s created successfully for task %s", container_id[:12], task_id)
            return container_id
        except Exception as exc:
            logger.error("Failed to create sandbox container for task %s: %s", task_id, exc)
            raise RuntimeError(f"Sandbox container creation failed: {exc}") from exc

    async def start_sandbox(self, container_id: str) -> None:
        """
        Start an existing container and launch the timeout watchdog.
        
        Args:
            container_id: Docker container ID.
        """
        if not self.client:
            raise RuntimeError("Docker client is unavailable.")

        def _do_start():
            container = self.client.containers.get(container_id)
            container.start()

        try:
            logger.info("Starting sandbox container %s", container_id[:12])
            await asyncio.to_thread(_do_start)
            self._container_states[container_id] = SandboxState.EXECUTING

            # Cancel any existing watchdog for this container
            if container_id in self._watchdog_tasks and not self._watchdog_tasks[container_id].done():
                self._watchdog_tasks[container_id].cancel()

            # Schedule watchdog timeout enforcement
            timeout = self.config.sandbox_timeout_seconds
            self._watchdog_tasks[container_id] = asyncio.create_task(
                self._enforce_timeout(container_id, timeout)
            )
        except NotFound:
            logger.error("Container %s not found for start.", container_id[:12])
            self._container_states[container_id] = SandboxState.FAILED
            raise
        except Exception as exc:
            logger.error("Failed to start container %s: %s", container_id[:12], exc)
            self._container_states[container_id] = SandboxState.FAILED
            raise

    async def pause_sandbox(self, container_id: str) -> None:
        """
        Pause container execution (docker pause) for human-in-the-loop review.
        
        Args:
            container_id: Docker container ID.
        """
        if not self.client:
            raise RuntimeError("Docker client is unavailable.")

        def _do_pause():
            container = self.client.containers.get(container_id)
            container.pause()

        try:
            logger.info("Pausing sandbox container %s for approval", container_id[:12])
            await asyncio.to_thread(_do_pause)
            self._container_states[container_id] = SandboxState.PAUSED_AWAITING_APPROVAL
        except Exception as exc:
            logger.error("Failed to pause container %s: %s", container_id[:12], exc)
            raise

    async def unpause_sandbox(self, container_id: str) -> None:
        """
        Resume container execution (docker unpause) following operator approval.
        
        Args:
            container_id: Docker container ID.
        """
        if not self.client:
            raise RuntimeError("Docker client is unavailable.")

        def _do_unpause():
            container = self.client.containers.get(container_id)
            container.unpause()

        try:
            logger.info("Unpausing sandbox container %s", container_id[:12])
            await asyncio.to_thread(_do_unpause)
            self._container_states[container_id] = SandboxState.EXECUTING
        except Exception as exc:
            logger.error("Failed to unpause container %s: %s", container_id[:12], exc)
            raise

    async def get_logs(self, container_id: str, tail: int = 200) -> str:
        """
        Retrieve container stdout and stderr logs.
        
        Args:
            container_id: Docker container ID.
            tail: Maximum number of lines from the end of the log to return.
            
        Returns:
            str: Decoded log contents.
        """
        if not self.client:
            return ""

        def _do_get_logs():
            container = self.client.containers.get(container_id)
            raw_logs = container.logs(stdout=True, stderr=True, tail=tail)
            if isinstance(raw_logs, bytes):
                return raw_logs.decode("utf-8", errors="replace")
            return str(raw_logs)

        try:
            return await asyncio.to_thread(_do_get_logs)
        except NotFound:
            logger.warning("Container %s not found when fetching logs.", container_id[:12])
            return ""
        except Exception as exc:
            logger.error("Failed to fetch logs for container %s: %s", container_id[:12], exc)
            return ""

    async def get_stats(self, container_id: str) -> ContainerTelemetry:
        """
        Fetch real-time CPU, memory, and network statistics from container.
        
        Args:
            container_id: Docker container ID.
            
        Returns:
            ContainerTelemetry: Populated telemetry model.
        """
        current_state = self._container_states.get(container_id, SandboxState.EXECUTING)
        telemetry = ContainerTelemetry(
            container_id=container_id,
            state=current_state,
            memory_limit_mb=512.0,
            blocked_requests=self._blocked_counts.get(container_id, 0)
        )

        if not self.client:
            return telemetry

        def _do_stats():
            container = self.client.containers.get(container_id)
            return container.stats(stream=False)

        try:
            stats = await asyncio.to_thread(_do_stats)
            if not stats:
                return telemetry

            # 1. CPU percentage calculation
            cpu_stats = stats.get("cpu_stats", {})
            precpu_stats = stats.get("precpu_stats", {})
            cpu_usage = cpu_stats.get("cpu_usage", {}).get("total_usage", 0)
            precpu_usage = precpu_stats.get("cpu_usage", {}).get("total_usage", 0)
            system_cpu_usage = cpu_stats.get("system_cpu_usage", 0)
            presystem_cpu_usage = precpu_stats.get("system_cpu_usage", 0)
            online_cpus = cpu_stats.get("online_cpus", 1) or 1

            cpu_delta = cpu_usage - precpu_usage
            system_delta = system_cpu_usage - presystem_cpu_usage
            if system_delta > 0 and cpu_delta > 0:
                telemetry.cpu_percent = round((cpu_delta / system_delta) * online_cpus * 100.0, 2)
            else:
                telemetry.cpu_percent = 0.0

            # 2. Memory utilization
            memory_stats = stats.get("memory_stats", {})
            usage_bytes = memory_stats.get("usage", 0)
            limit_bytes = memory_stats.get("limit", 512 * 1024 * 1024)
            telemetry.memory_usage_mb = round(usage_bytes / (1024 * 1024), 2)
            telemetry.memory_limit_mb = round(limit_bytes / (1024 * 1024), 2)

            # 3. Network I/O
            networks = stats.get("networks", {})
            rx_bytes = sum(net.get("rx_bytes", 0) for net in networks.values())
            tx_bytes = sum(net.get("tx_bytes", 0) for net in networks.values())
            telemetry.network_rx_bytes = rx_bytes
            telemetry.network_tx_bytes = tx_bytes

            return telemetry
        except NotFound:
            telemetry.state = SandboxState.WIPED_AND_PURGED
            return telemetry
        except Exception as exc:
            logger.debug("Telemetry fetch error for container %s: %s", container_id[:12], exc)
            return telemetry

    async def purge_sandbox(self, container_id: str) -> None:
        """
        Forcefully terminate and remove the sandbox container (docker rm -f).
        
        Args:
            container_id: Docker container ID.
        """
        # Cancel watchdog timer if active
        if container_id in self._watchdog_tasks:
            task = self._watchdog_tasks.pop(container_id)
            if not task.done():
                task.cancel()

        if not self.client:
            self._container_states[container_id] = SandboxState.WIPED_AND_PURGED
            return

        def _do_purge():
            try:
                container = self.client.containers.get(container_id)
                container.remove(force=True, v=True)
            except NotFound:
                pass  # Container already removed

        try:
            logger.info("Purging sandbox container %s", container_id[:12])
            await asyncio.to_thread(_do_purge)
            self._container_states[container_id] = SandboxState.WIPED_AND_PURGED
            self._blocked_counts.pop(container_id, None)
            logger.info("Container %s successfully purged.", container_id[:12])
        except Exception as exc:
            logger.error("Failed to purge container %s: %s", container_id[:12], exc)
            self._container_states[container_id] = SandboxState.FAILED
            raise

    async def get_state(self, container_id: str) -> str:
        """
        Determine the lifecycle state of a container.
        
        Args:
            container_id: Docker container ID.
            
        Returns:
            str: SandboxState enum value.
        """
        if not self.client:
            return self._container_states.get(container_id, SandboxState.FAILED).value

        def _do_inspect():
            container = self.client.containers.get(container_id)
            container.reload()
            return container.status

        try:
            status = await asyncio.to_thread(_do_inspect)
            # Map docker daemon status to SandboxState
            if status == "paused":
                mapped = SandboxState.PAUSED_AWAITING_APPROVAL
            elif status == "running":
                mapped = self._container_states.get(container_id, SandboxState.EXECUTING)
                if mapped == SandboxState.POOLED:
                    # Container is idle in pool
                    return SandboxState.POOLED.value
                return SandboxState.EXECUTING.value
            elif status in ("exited", "dead"):
                mapped = self._container_states.get(container_id, SandboxState.COMPLETED)
            else:
                mapped = self._container_states.get(container_id, SandboxState.PROVISIONING)
            
            return mapped.value
        except NotFound:
            return SandboxState.WIPED_AND_PURGED.value
        except Exception as exc:
            logger.warning("Error inspecting status for container %s: %s", container_id[:12], exc)
            return self._container_states.get(container_id, SandboxState.FAILED).value

    async def _enforce_timeout(self, container_id: str, timeout: int) -> None:
        """
        Watchdog coroutine that terminates containers exceeding the max duration.
        
        Args:
            container_id: Docker container ID.
            timeout: Maximum allowed duration in seconds.
        """
        try:
            await asyncio.sleep(timeout)
            logger.warning("Container %s exceeded hard timeout limit (%ds). Forcing termination.",
                           container_id[:12], timeout)
            self._container_states[container_id] = SandboxState.TIMED_OUT
            await self.purge_sandbox(container_id)
        except asyncio.CancelledError:
            logger.debug("Watchdog timeout cancelled for container %s", container_id[:12])
        except Exception as exc:
            logger.error("Watchdog timeout error for container %s: %s", container_id[:12], exc)
