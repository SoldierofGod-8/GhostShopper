"""
Two-tier price verification engine for Ghost Shopper.

Tier 1 performs instant, local deterministic validation (regex, range checks, discount thresholds).
Tier 2 activates upon anomaly detection to inspect full-page viewport screenshots using
Vultr Serverless Inference (Llama 3.2 Vision).
"""

import base64
import json
import logging
import mimetypes
import os
import re
from typing import Any, Dict, Optional, Tuple, Union

import httpx

from config import Settings, get_settings
from models import PriceData, VerificationTier

logger = logging.getLogger("ghost_shopper.verifier")


class TwoTierVerifier:
    """
    Two-tier verification engine for extracted e-commerce product prices.
    
    Tier 1 (Local):
      - Rejects $0.00 or negative prices.
      - Rejects discounts exceeding 90% (likely deceptive or scraping error).
      - Enforces strict currency regex matching.
      - Identifies phone numbers, serial codes, and non-price strings.
      
    Tier 2 (Vision LLM):
      - Dispatches base64 screenshot to Vultr Serverless Inference (Llama 3.2 Vision).
      - Cross-verifies visual price tag against DOM extraction.
      - Resolves ambiguity (e.g. strikethrough original prices vs. sale prices).
    """

    # Currency extraction regex patterns
    PRICE_PATTERN = re.compile(
        r"(?:[\$\€\£\¥\₹]|USD|EUR|GBP|CAD|AUD)?\s*([0-9]{1,3}(?:[,\.][0-9]{3})*(?:[\.,][0-9]{2})?|[0-9]+)\s*(?:USD|EUR|GBP|CAD|AUD)?",
        re.IGNORECASE
    )

    CURRENCY_SYMBOLS: Dict[str, str] = {
        "$": "USD",
        "€": "EUR",
        "£": "GBP",
        "¥": "JPY",
        "₹": "INR"
    }

    def __init__(
        self,
        config: Optional[Settings] = None,
        client: Optional[httpx.AsyncClient] = None
    ):
        """
        Initialize the TwoTierVerifier.
        
        Args:
            config: Optional Settings instance. If omitted, global settings are used.
            client: Optional shared httpx.AsyncClient.
        """
        self.config = config or get_settings()
        self._external_client = client
        self._internal_client: Optional[httpx.AsyncClient] = None

    async def _get_http_client(self) -> httpx.AsyncClient:
        """Retrieve or instantiate an async HTTP client with custom timeouts."""
        if self._external_client is not None:
            return self._external_client
        if self._internal_client is None or self._internal_client.is_closed:
            self._internal_client = httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=10.0))
        return self._internal_client

    async def close(self) -> None:
        """Close the internal HTTP client session."""
        if self._internal_client is not None and not self._internal_client.is_closed:
            await self._internal_client.aclose()
            self._internal_client = None

    def _tier1_validate(
        self,
        raw_price: str,
        original_price: Optional[str] = None
    ) -> Tuple[bool, str]:
        """
        Perform local deterministic regex and numerical boundary validation.
        
        Args:
            raw_price: Raw price text string from DOM.
            original_price: Optional original or strikethrough price text for discount calculation.
            
        Returns:
            Tuple[bool, str]: (is_valid, anomaly_reason). If is_valid is True, reason is empty.
        """
        if not raw_price or not raw_price.strip():
            return False, "Price string is empty or whitespace"

        text = raw_price.strip()

        # Reject common placeholder or error words
        lower_text = text.lower()
        if any(term in lower_text for term in ["free", "null", "none", "nan", "undefined", "out of stock", "call for price"]):
            return False, f"Price text contains non-price placeholder: '{text}'"

        # Extract numeric value
        clean_num_str = re.sub(r"[^\d\.,]", "", text)
        if not clean_num_str:
            return False, f"No numeric digits found in price text: '{text}'"

        # Normalize European decimal commas (e.g. 19,99 -> 19.99)
        if "," in clean_num_str and "." not in clean_num_str:
            clean_num_str = clean_num_str.replace(",", ".")
        elif "," in clean_num_str and "." in clean_num_str:
            # Comma is thousands separator (e.g., 1,299.99)
            clean_num_str = clean_num_str.replace(",", "")

        try:
            val = float(clean_num_str)
        except ValueError:
            return False, f"Failed to parse numeric value from price text: '{text}'"

        # 1. Zero or negative price check
        if val <= 0.0:
            return False, f"Extracted price is zero or negative (${val:.2f})"

        # 2. Absurdly large price bounds (or phone numbers / zip codes mistakenly scraped)
        if val > 1_000_000.0:
            return False, f"Price (${val:,.2f}) exceeds standard retail upper bound ($1,000,000)"

        # Check for phone number false positives (7 or 10-11 contiguous digits with no decimal)
        digits_only = re.sub(r"\D", "", text)
        if len(digits_only) in (7, 10, 11) and "." not in clean_num_str and val > 100_000:
            return False, f"Price resembles phone number or serial number: '{text}'"

        # 3. Check discount threshold (>90% anomaly)
        if original_price:
            orig_clean = re.sub(r"[^\d\.,]", "", original_price.strip())
            if "," in orig_clean and "." not in orig_clean:
                orig_clean = orig_clean.replace(",", ".")
            elif "," in orig_clean and "." in orig_clean:
                orig_clean = orig_clean.replace(",", "")

            try:
                orig_val = float(orig_clean)
                if orig_val > val:
                    discount_ratio = (orig_val - val) / orig_val
                    if discount_ratio > 0.90:
                        return False, f"Extreme discount detected ({discount_ratio * 100:.1f}% off from ${orig_val:.2f} to ${val:.2f})"
            except ValueError:
                pass

        # 4. Check for common price format structure
        if not self.PRICE_PATTERN.search(text):
            return False, f"Price text does not match standard currency format: '{text}'"

        return True, ""

    def _extract_price_and_currency(self, raw_text: str) -> Tuple[Optional[float], str]:
        """
        Extract numerical float value and ISO currency code from raw text.
        
        Args:
            raw_text: Raw text containing price and symbol.
            
        Returns:
            Tuple[Optional[float], str]: (parsed_price, currency_code).
        """
        currency = "USD"
        for symbol, code in self.CURRENCY_SYMBOLS.items():
            if symbol in raw_text:
                currency = code
                break

        for code in ["USD", "EUR", "GBP", "CAD", "AUD", "JPY"]:
            if code in raw_text.upper():
                currency = code
                break

        clean_num_str = re.sub(r"[^\d\.,]", "", raw_text)
        if "," in clean_num_str and "." not in clean_num_str:
            clean_num_str = clean_num_str.replace(",", ".")
        elif "," in clean_num_str and "." in clean_num_str:
            clean_num_str = clean_num_str.replace(",", "")

        try:
            parsed = float(clean_num_str) if clean_num_str else None
        except ValueError:
            parsed = None

        return parsed, currency

    async def _tier2_vision_verify(
        self,
        screenshot_path: str,
        raw_price: str,
        task_id: str
    ) -> PriceData:
        """
        Submit screenshot to Vultr Serverless Inference (Llama 3.2 Vision) for AI audit.
        
        Args:
            screenshot_path: Path to the viewport screenshot file.
            raw_price: Suspect price string extracted during Tier 1.
            task_id: Task identifier for correlation.
            
        Returns:
            PriceData: Verified price and confidence model.
        """
        if not os.path.isfile(screenshot_path):
            logger.warning("Screenshot '%s' does not exist for task %s. Tier 2 vision cannot proceed.",
                           screenshot_path, task_id)
            parsed_price, currency = self._extract_price_and_currency(raw_price)
            return PriceData(
                raw_text=raw_price,
                parsed_price=parsed_price,
                currency=currency,
                confidence=0.30,
                verification_tier=VerificationTier.TIER_2_VISION_LLM,
                anomaly_detected=True,
                anomaly_reason="Screenshot file not found for Tier 2 vision inspection"
            )

        if not self.config.vultr_inference_api_key:
            logger.warning("Vultr Inference API key is missing. Skipping Tier 2 Vision verification.")
            parsed_price, currency = self._extract_price_and_currency(raw_price)
            return PriceData(
                raw_text=raw_price,
                parsed_price=parsed_price,
                currency=currency,
                confidence=0.40,
                verification_tier=VerificationTier.TIER_2_VISION_LLM,
                anomaly_detected=True,
                anomaly_reason="Tier 1 anomaly flagged; Vultr API key missing for Tier 2 vision"
            )

        # Encode screenshot into base64 payload
        try:
            with open(screenshot_path, "rb") as image_file:
                image_bytes = image_file.read()
            b64_image = base64.b64encode(image_bytes).decode("utf-8")
        except Exception as exc:
            logger.error("Failed to read screenshot %s: %s", screenshot_path, exc)
            parsed_price, currency = self._extract_price_and_currency(raw_price)
            return PriceData(
                raw_text=raw_price,
                parsed_price=parsed_price,
                currency=currency,
                confidence=0.30,
                verification_tier=VerificationTier.TIER_2_VISION_LLM,
                anomaly_detected=True,
                anomaly_reason=f"Failed to read screenshot file: {exc}"
            )

        # Detect MIME type
        mime_type, _ = mimetypes.guess_type(screenshot_path)
        if not mime_type or not mime_type.startswith("image/"):
            mime_type = "image/png"

        prompt = (
            "You are an expert e-commerce quality assurance auditor. Inspect the attached product page screenshot.\n"
            f"The scraper extracted the following suspect raw price text: '{raw_price}'.\n"
            "Your tasks:\n"
            "1. Locate the true retail price displayed on the webpage for the primary product.\n"
            "2. Identify currency (e.g., USD, EUR, GBP).\n"
            "3. Verify whether the extracted price is legitimate or an anomaly (e.g. $0 glitch, misleading >90% discount, installment price, or out-of-stock placeholder).\n"
            "4. Respond with valid JSON ONLY in the following format:\n"
            "{\n"
            '  "verified_price": 49.99,\n'
            '  "currency": "USD",\n'
            '  "is_valid": true,\n'
            '  "confidence": 0.95,\n'
            '  "anomaly_detected": false,\n'
            '  "anomaly_reason": "",\n'
            '  "explanation": "Brief explanation of what price was visible."\n'
            "}"
        )

        request_body = {
            "model": self.config.vultr_vision_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{b64_image}"
                            }
                        }
                    ]
                }
            ],
            "max_tokens": 512,
            "temperature": 0.1
        }

        headers = {
            "Authorization": f"Bearer {self.config.vultr_inference_api_key}",
            "Content-Type": "application/json"
        }

        logger.info("Submitting task %s screenshot to Vultr Vision LLM (%s)...",
                    task_id, self.config.vultr_vision_model)

        http_client = await self._get_http_client()
        try:
            response = await http_client.post(
                self.config.vultr_inference_endpoint,
                headers=headers,
                json=request_body
            )
            response.raise_for_status()
            response_json = response.json()

            # Parse completion content
            choices = response_json.get("choices", [])
            if not choices:
                raise ValueError("No completion choices returned by Vultr Inference.")

            content = choices[0].get("message", {}).get("content", "")
            
            # Clean possible markdown JSON wrappers (```json ... ```)
            cleaned_content = re.sub(r"^```json\s*", "", content.strip(), flags=re.IGNORECASE)
            cleaned_content = re.sub(r"^```\s*", "", cleaned_content)
            cleaned_content = re.sub(r"\s*```$", "", cleaned_content)

            parsed_data = json.loads(cleaned_content)
            
            verified_price = parsed_data.get("verified_price")
            if verified_price is not None:
                try:
                    verified_price = float(verified_price)
                except (ValueError, TypeError):
                    verified_price = None

            currency = str(parsed_data.get("currency", "USD")).upper()
            confidence = float(parsed_data.get("confidence", 0.85))
            anomaly_detected = bool(parsed_data.get("anomaly_detected", False))
            anomaly_reason = parsed_data.get("anomaly_reason") or parsed_data.get("explanation", "")

            logger.info("Vultr Vision verified task %s: price=%s %s, confidence=%0.2f, anomaly=%s",
                        task_id, verified_price, currency, confidence, anomaly_detected)

            return PriceData(
                raw_text=raw_price,
                parsed_price=verified_price,
                currency=currency,
                confidence=min(max(confidence, 0.0), 1.0),
                verification_tier=VerificationTier.TIER_2_VISION_LLM,
                anomaly_detected=anomaly_detected,
                anomaly_reason=anomaly_reason
            )

        except httpx.HTTPStatusError as http_err:
            logger.error("Vultr Inference API HTTP %d error: %s",
                         http_err.response.status_code, http_err.response.text)
            parsed_price, currency = self._extract_price_and_currency(raw_price)
            return PriceData(
                raw_text=raw_price,
                parsed_price=parsed_price,
                currency=currency,
                confidence=0.35,
                verification_tier=VerificationTier.TIER_2_VISION_LLM,
                anomaly_detected=True,
                anomaly_reason=f"Vultr Inference HTTP error ({http_err.response.status_code})"
            )
        except Exception as exc:
            logger.error("Error during Tier 2 Vision LLM verification for task %s: %s", task_id, exc)
            parsed_price, currency = self._extract_price_and_currency(raw_price)
            return PriceData(
                raw_text=raw_price,
                parsed_price=parsed_price,
                currency=currency,
                confidence=0.35,
                verification_tier=VerificationTier.TIER_2_VISION_LLM,
                anomaly_detected=True,
                anomaly_reason=f"Vision verification exception: {exc}"
            )

    async def verify(
        self,
        price_data: Union[Dict[str, Any], PriceData],
        screenshot_path: Optional[str] = None,
        task_id: str = ""
    ) -> PriceData:
        """
        Verify product pricing data using the two-tier verification workflow.
        
        Args:
            price_data: Input price dictionary or PriceData model.
            screenshot_path: Optional local path to viewport screenshot.
            task_id: Optional task identifier for logging and traceability.
            
        Returns:
            PriceData: Validated and verified pricing model with tier and confidence.
        """
        if isinstance(price_data, dict):
            # Instantiate or parse into PriceData
            raw_text = price_data.get("raw_text", "")
            orig_price = price_data.get("original_price")
            parsed_val, currency = self._extract_price_and_currency(raw_text)
            pd = PriceData(
                raw_text=raw_text,
                parsed_price=price_data.get("parsed_price", parsed_val),
                currency=price_data.get("currency", currency),
                confidence=price_data.get("confidence", 0.0),
                verification_tier=VerificationTier.TIER_1_LOCAL,
                anomaly_detected=False,
                anomaly_reason=""
            )
        else:
            pd = price_data.model_copy(deep=True)
            orig_price = None

        # Execute Tier 1 local validation
        is_valid, anomaly_reason = self._tier1_validate(pd.raw_text, original_price=orig_price)

        if is_valid:
            # Passed Tier 1
            if pd.parsed_price is None:
                parsed_val, currency = self._extract_price_and_currency(pd.raw_text)
                pd.parsed_price = parsed_val
                pd.currency = currency

            pd.confidence = 0.95
            pd.verification_tier = VerificationTier.TIER_1_LOCAL
            pd.anomaly_detected = False
            pd.anomaly_reason = ""
            logger.info("Task %s passed Tier 1 validation: price=%s %s",
                        task_id, pd.parsed_price, pd.currency)
            return pd

        # Tier 1 flagged an anomaly
        logger.warning("Task %s flagged Tier 1 anomaly: %s. Escalating to Tier 2 Vision LLM.",
                       task_id, anomaly_reason)
        pd.anomaly_detected = True
        pd.anomaly_reason = anomaly_reason

        # Escalate to Tier 2 if screenshot exists
        if screenshot_path and os.path.exists(screenshot_path):
            vision_result = await self._tier2_vision_verify(
                screenshot_path=screenshot_path,
                raw_price=pd.raw_text,
                task_id=task_id
            )
            return vision_result
        else:
            # Tier 2 could not run because screenshot is unavailable
            pd.verification_tier = VerificationTier.TIER_1_LOCAL
            pd.confidence = 0.30
            pd.anomaly_reason = f"{anomaly_reason} (Tier 2 skipped: screenshot unavailable)"
            return pd
