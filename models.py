"""
Data models and schemas for Ghost Shopper.

Defines Pydantic representations for requests, scrape results, price verification,
container states, telemetry, human-in-the-loop approvals, and real-time WebSocket payloads.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
import uuid

from pydantic import BaseModel, Field, HttpUrl


def _utc_now() -> datetime:
    """Helper to return current UTC datetime."""
    return datetime.now(timezone.utc)


class SandboxState(str, Enum):
    """
    Lifecycle states for an isolated scraper sandbox container.
    """
    POOLED = 'POOLED'
    PROVISIONING = 'PROVISIONING'
    EXECUTING = 'EXECUTING'
    PAUSED_AWAITING_APPROVAL = 'PAUSED_AWAITING_APPROVAL'
    VERIFYING = 'VERIFYING'
    COMPLETED = 'COMPLETED'
    FAILED = 'FAILED'
    WIPED_AND_PURGED = 'WIPED_AND_PURGED'
    TIMED_OUT = 'TIMED_OUT'


class VerificationTier(str, Enum):
    """
    Price verification tier applied to extracted product data.
    """
    TIER_1_LOCAL = 'TIER_1_LOCAL'
    TIER_2_VISION_LLM = 'TIER_2_VISION_LLM'


class ScrapeRequest(BaseModel):
    """
    Client request containing target URLs to scrape in an isolated sandbox batch.
    """
    urls: List[str] = Field(
        ...,
        description="List of target product web URLs to scrape"
    )
    batch_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique identifier for the scrape batch"
    )


class GoalRequest(BaseModel):
    """
    Pattern B (Sandboxed Browser Use): High-level goal submitted by user.
    The orchestrator plans actions, provisions gVisor sandboxes, runs Playwright,
    verifies screenshots with Vultr Llama 3.2 Vision, and executes HITL reviews.
    """
    goal: str = Field(
        ...,
        description="Natural language goal (e.g., 'Compare Sony WH-1000XM5 across Best Buy & Walmart')"
    )
    stealth_profile: str = Field(
        default="ghost",
        description="Stealth profile ('ghost', 'paranoid', 'aggressive')"
    )
    concurrency: int = Field(
        default=3,
        ge=1,
        le=10,
        description="Parallel sandbox concurrency limit"
    )
    batch_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Generated batch correlation ID"
    )


class ContainmentDemoType(str, Enum):
    """
    Containment moment scenarios designed for the Vultr video submission demonstration.
    """
    SSRF_METADATA_ATTACK = "SSRF_METADATA_ATTACK"
    MEMORY_BOMB_OOM = "MEMORY_BOMB_OOM"
    DECEPTIVE_PRICE_HITL = "DECEPTIVE_PRICE_HITL"


class ContainmentDemoRequest(BaseModel):
    """
    Trigger request for demonstrating real containment enforcement on Vultr.
    """
    scenario: ContainmentDemoType = Field(
        default=ContainmentDemoType.SSRF_METADATA_ATTACK,
        description="The containment attack vector to demonstrate"
    )


class VultrConfigRequest(BaseModel):
    """
    Request payload for dynamically updating Vultr credentials from UI or API.
    """
    vultr_api_key: Optional[str] = Field(default=None, description="Vultr Cloud Account API Key")
    vultr_inference_api_key: Optional[str] = Field(default=None, description="Vultr Serverless Inference API Key")
    vultr_vision_model: Optional[str] = Field(default=None, description="Vision LLM model name")
    api_key: Optional[str] = Field(default=None, description="Alias for vultr_api_key")
    inference_key: Optional[str] = Field(default=None, description="Alias for vultr_inference_api_key")
    vision_model: Optional[str] = Field(default=None, description="Alias for vultr_vision_model")


class VultrConfigResponse(BaseModel):
    """
    Response details for Vultr infrastructure credentials and connectivity status.
    """
    vultr_api_key_configured: bool = False
    vultr_inference_key_configured: bool = False
    vultr_vision_model: str = "llama-3.2-90b-vision-preview"
    vultr_inference_endpoint: str = "https://api.vultrinference.com/v1/chat/completions"
    mode: str = "simulation"
    masked_account_key: str = ""
    masked_inference_key: str = ""
    status_message: str = ""


class PriceData(BaseModel):
    """
    Structured price information extracted and verified from an e-commerce page.
    """
    raw_text: str = Field(
        default="",
        description="Original unparsed price text extracted from the DOM"
    )
    parsed_price: Optional[float] = Field(
        default=None,
        description="Normalized numerical price value in floating point"
    )
    currency: str = Field(
        default="USD",
        description="Currency code (e.g., USD, EUR, GBP)"
    )
    confidence: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Confidence score between 0.0 and 1.0"
    )
    verification_tier: VerificationTier = Field(
        default=VerificationTier.TIER_1_LOCAL,
        description="Tier used for verifying this price extraction"
    )
    anomaly_detected: bool = Field(
        default=False,
        description="Indicates whether an extraction anomaly was flagged"
    )
    anomaly_reason: str = Field(
        default="",
        description="Detailed description of why an anomaly was flagged"
    )


class ScrapeResult(BaseModel):
    """
    Execution summary and extracted data for a single target URL.
    """
    task_id: str = Field(
        ...,
        description="Unique identifier for this specific scraping task"
    )
    url: str = Field(
        ...,
        description="The target web page URL that was scraped"
    )
    state: SandboxState = Field(
        ...,
        description="Final or current lifecycle state of the sandbox task"
    )
    container_id: Optional[str] = Field(
        default=None,
        description="Docker container ID associated with this task"
    )
    price_data: Optional[PriceData] = Field(
        default=None,
        description="Verified price extraction data"
    )
    product_title: str = Field(
        default="",
        description="Extracted name or title of the product"
    )
    screenshot_path: Optional[str] = Field(
        default=None,
        description="File path to the full-page viewport screenshot"
    )
    error: Optional[str] = Field(
        default=None,
        description="Error description if the scraping task failed"
    )
    started_at: Optional[datetime] = Field(
        default=None,
        description="Timestamp when container execution started"
    )
    completed_at: Optional[datetime] = Field(
        default=None,
        description="Timestamp when scraping completed or terminated"
    )
    resource_usage: Dict[str, Any] = Field(
        default_factory=dict,
        description="Container resource metrics (CPU, memory, execution duration)"
    )
    logs: List[str] = Field(
        default_factory=list,
        description="Collected stdout/stderr log lines from the container"
    )


class BatchResult(BaseModel):
    """
    Aggregated response containing results for all URLs in a requested batch.
    """
    batch_id: str = Field(
        ...,
        description="Identifier of the batch"
    )
    total_urls: int = Field(
        ...,
        description="Total count of URLs requested in this batch"
    )
    results: List[ScrapeResult] = Field(
        default_factory=list,
        description="List of individual scrape outcomes"
    )
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="Timestamp when the batch was created"
    )


class ContainerTelemetry(BaseModel):
    """
    Real-time performance and security metrics collected from a running container.
    """
    container_id: str = Field(
        ...,
        description="Docker container ID"
    )
    cpu_percent: float = Field(
        default=0.0,
        description="Current CPU utilization percentage"
    )
    memory_usage_mb: float = Field(
        default=0.0,
        description="Current resident memory usage in megabytes"
    )
    memory_limit_mb: float = Field(
        default=512.0,
        description="Maximum configured memory limit in megabytes"
    )
    network_rx_bytes: int = Field(
        default=0,
        description="Total inbound network bytes received"
    )
    network_tx_bytes: int = Field(
        default=0,
        description="Total outbound network bytes transmitted"
    )
    state: SandboxState = Field(
        default=SandboxState.POOLED,
        description="Current state of the sandbox"
    )
    blocked_requests: int = Field(
        default=0,
        description="Count of network egress requests blocked by security policies"
    )


class ApprovalRequest(BaseModel):
    """
    Human-in-the-loop authorization trigger when suspicious anti-bot or CAPTCHA is detected.
    """
    container_id: str = Field(
        ...,
        description="Container currently held in paused state"
    )
    task_id: str = Field(
        ...,
        description="Scrape task ID requiring intervention"
    )
    reason: str = Field(
        ...,
        description="Reason container was paused (e.g., CAPTCHA, Cloudflare challenge)"
    )
    screenshot_path: Optional[str] = Field(
        default=None,
        description="Screenshot of the challenge prompt for operator review"
    )
    paused_at: datetime = Field(
        default_factory=datetime.utcnow,
        description="Timestamp when the container paused execution"
    )


class WebSocketMessage(BaseModel):
    """
    Standard message envelope dispatched across WebSocket channels to UI dashboards.
    """
    event: str = Field(
        ...,
        description="Event type name ('log', 'state_change', 'telemetry', 'approval_request', 'result')"
    )
    task_id: Optional[str] = Field(
        default=None,
        description="Associated task ID if applicable"
    )
    container_id: Optional[str] = Field(
        default=None,
        description="Associated container ID if applicable"
    )
    data: Dict[str, Any] = Field(
        default_factory=dict,
        description="Event payload payload details"
    )
    timestamp: datetime = Field(
        default_factory=datetime.utcnow,
        description="Message dispatch timestamp"
    )
