"""
Pre-warmed container pool manager for Ghost Shopper.

Maintains a pool of pre-warmed gVisor sandboxes to eliminate container startup latency
and ensure immediate execution readiness for web scraping jobs.
"""

import asyncio
import logging
from typing import Any, Dict, Optional, Set
import uuid

from config import Settings, get_settings
from models import SandboxState
from sandbox_manager import SandboxManager

logger = logging.getLogger("ghost_shopper.warm_pool")


class WarmPoolManager:
    """
    Manages a dynamic pool of pre-initialized, isolated container sandboxes.
    
    Provides:
      - Rapid container acquisition via asyncio.Queue
      - Background replenishment loop (evaluates every 5 seconds)
      - Dynamic burst scaling up to warm_pool_max
      - Graceful draining and teardown of pooled containers
    """

    def __init__(
        self,
        sandbox_manager: SandboxManager,
        config: Optional[Settings] = None
    ):
        """
        Initialize the WarmPoolManager.
        
        Args:
            sandbox_manager: Instance of SandboxManager for container operations.
            config: Optional Settings instance. If omitted, global settings are used.
        """
        self.sandbox_manager = sandbox_manager
        self.config = config or get_settings()
        
        self.pool: asyncio.Queue[str] = asyncio.Queue()
        self.active_containers: Set[str] = set()
        self.all_provisioned: Set[str] = set()
        
        self._replenish_task: Optional[asyncio.Task] = None
        self._running: bool = False
        self._lock: asyncio.Lock = asyncio.Lock()

    async def start(self) -> None:
        """
        Start the background pool replenishment worker and perform initial fill.
        """
        async with self._lock:
            if self._running:
                logger.warning("WarmPoolManager is already running.")
                return

            self._running = True
            logger.info(
                "Starting WarmPoolManager (target_size=%d, max_size=%d)",
                self.config.warm_pool_size,
                self.config.warm_pool_max
            )

            # Perform initial replenishment synchronously to warm the baseline pool
            await self._fill_pool_to_target()

            # Launch background replenishment watchdog
            self._replenish_task = asyncio.create_task(
                self._replenish_loop(),
                name="warm_pool_replenish_loop"
            )

    async def acquire(self, timeout: float = 10.0) -> str:
        """
        Acquire a warm container from the pool with timeout.
        
        If the queue is depleted but total containers are below warm_pool_max,
        provisions an on-demand container immediately.
        
        Args:
            timeout: Maximum seconds to wait for an available container.
            
        Returns:
            str: Container ID ready for execution.
            
        Raises:
            TimeoutError: If no container could be acquired within the timeout window.
            RuntimeError: If provisioning fails during acquisition.
        """
        if not self._running:
            raise RuntimeError("WarmPoolManager is not running. Call start() first.")

        logger.info(
            "Acquisition requested (pool_available=%d, active=%d, total=%d)",
            self.pool.qsize(),
            len(self.active_containers),
            len(self.all_provisioned)
        )

        # 1. First attempt to pull directly from available pre-warmed queue
        try:
            container_id = await asyncio.wait_for(self.pool.get(), timeout=min(timeout, 2.0))
            
            # Verify container is still viable
            state = await self.sandbox_manager.get_state(container_id)
            if state in (SandboxState.FAILED.value, SandboxState.WIPED_AND_PURGED.value):
                logger.warning("Pooled container %s is in state '%s'. Discarding and retrying.",
                               container_id[:12], state)
                self.all_provisioned.discard(container_id)
                return await self.acquire(timeout=timeout)

            self.active_containers.add(container_id)
            self.sandbox_manager._container_states[container_id] = SandboxState.EXECUTING
            logger.info("Acquired warm container %s from pool", container_id[:12])
            return container_id

        except asyncio.TimeoutError:
            # 2. Queue was empty; check if we can spin up an on-demand container
            async with self._lock:
                if len(self.all_provisioned) < self.config.warm_pool_max:
                    logger.info("Pool empty. Burst provisioning on-demand container (limit %d).",
                                self.config.warm_pool_max)
                    container_id = await self._provision_container()
                    self.active_containers.add(container_id)
                    self.sandbox_manager._container_states[container_id] = SandboxState.EXECUTING
                    return container_id

            # 3. Maximum containers reached; wait for an existing task to return/finish
            logger.warning("Pool empty and at max capacity (%d). Waiting up to %0.1fs for release.",
                           self.config.warm_pool_max, timeout)
            try:
                container_id = await asyncio.wait_for(self.pool.get(), timeout=timeout)
                self.active_containers.add(container_id)
                self.sandbox_manager._container_states[container_id] = SandboxState.EXECUTING
                return container_id
            except asyncio.TimeoutError:
                raise TimeoutError(
                    f"Timed out after {timeout}s waiting for an available sandbox container. "
                    f"Active: {len(self.active_containers)}, Max: {self.config.warm_pool_max}"
                )

    async def _provision_container(self) -> str:
        """
        Create and start a new container in POOLED state.
        
        Returns:
            str: Container ID.
        """
        pooled_id = f"pooled-{uuid.uuid4().hex[:8]}"
        logger.debug("Provisioning new pooled container (%s)...", pooled_id)
        
        container_id = await self.sandbox_manager.create_sandbox(
            task_id=pooled_id,
            command="/bin/sh -c 'tail -f /dev/null'"
        )
        
        await self.sandbox_manager.start_sandbox(container_id)
        self.sandbox_manager._container_states[container_id] = SandboxState.POOLED
        self.all_provisioned.add(container_id)
        
        logger.info("Successfully provisioned warm container %s (%s)", container_id[:12], pooled_id)
        return container_id

    async def _fill_pool_to_target(self) -> None:
        """
        Top up the pool up to warm_pool_size if capacity allows.
        """
        current_available = self.pool.qsize()
        current_total = len(self.all_provisioned)
        deficit = self.config.warm_pool_size - current_available
        headroom = self.config.warm_pool_max - current_total

        if deficit <= 0 or headroom <= 0:
            return

        to_provision = min(deficit, headroom)
        logger.debug("Replenishing %d containers into warm pool...", to_provision)

        for _ in range(to_provision):
            try:
                container_id = await self._provision_container()
                await self.pool.put(container_id)
            except Exception as exc:
                logger.error("Error provisioning warm pool container: %s", exc)
                break

    async def _replenish_loop(self) -> None:
        """
        Background loop executing every 5 seconds to inspect pool health and replenish.
        """
        logger.info("Pool replenish loop started (interval=5s).")
        while self._running:
            try:
                await asyncio.sleep(5)
                if not self._running:
                    break

                async with self._lock:
                    await self._fill_pool_to_target()

            except asyncio.CancelledError:
                logger.debug("Replenish loop received cancellation.")
                break
            except Exception as exc:
                logger.error("Unexpected error in warm pool replenishment loop: %s", exc)
                await asyncio.sleep(2)

    async def release(self, container_id: str) -> None:
        """
        Release and purge a used container to preserve strict zero-trust sandbox hygiene.
        
        Ephemeral containers are destroyed after each run to eliminate cross-contamination,
        and the replenishment loop replaces them with fresh clean sandboxes.
        
        Args:
            container_id: Docker container ID to decommission.
        """
        async with self._lock:
            self.active_containers.discard(container_id)
            self.all_provisioned.discard(container_id)

        try:
            logger.info("Decommissioning used container %s for zero-trust hygiene.", container_id[:12])
            await self.sandbox_manager.purge_sandbox(container_id)
        except Exception as exc:
            logger.warning("Error purging container %s during release: %s", container_id[:12], exc)

    def get_pool_status(self) -> Dict[str, Any]:
        """
        Return snapshot statistics of the current pool state.
        
        Returns:
            dict: Pool sizing and utilization metrics.
        """
        return {
            "pool_size": self.pool.qsize(),
            "available_count": self.pool.qsize(),
            "active_count": len(self.active_containers),
            "total_provisioned": len(self.all_provisioned),
            "target_pool_size": self.config.warm_pool_size,
            "max_pool_size": self.config.warm_pool_max,
            "is_running": self._running,
        }

    async def shutdown(self) -> None:
        """
        Drain all queued containers and purge all managed sandboxes.
        """
        logger.info("Shutting down WarmPoolManager...")
        async with self._lock:
            self._running = False

            if self._replenish_task and not self._replenish_task.done():
                self._replenish_task.cancel()
                try:
                    await self._replenish_task
                except asyncio.CancelledError:
                    pass

            # Gather all containers that need to be wiped
            containers_to_purge = list(self.all_provisioned)
            
            # Drain queue
            while not self.pool.empty():
                try:
                    self.pool.get_nowait()
                except asyncio.QueueEmpty:
                    break

            self.active_containers.clear()
            self.all_provisioned.clear()

        # Purge all containers in parallel
        if containers_to_purge:
            logger.info("Purging %d containers during pool shutdown...", len(containers_to_purge))
            purge_tasks = [
                self.sandbox_manager.purge_sandbox(cid)
                for cid in containers_to_purge
            ]
            results = await asyncio.gather(*purge_tasks, return_exceptions=True)
            for cid, res in zip(containers_to_purge, results):
                if isinstance(res, Exception):
                    logger.warning("Error purging container %s during shutdown: %s", cid[:12], res)

        logger.info("WarmPoolManager shutdown complete.")
