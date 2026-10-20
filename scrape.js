/**
 * ============================================================================
 * Ghost Shopper - Sandboxed Playwright Worker Script
 * ============================================================================
 * 
 * This script is the core scraping and data extraction engine that executes
 * inside an isolated Docker container with gVisor (runsc) virtualization.
 * 
 * Security Architecture & Sandboxing:
 * ------------------------------------
 * 1. gVisor (runsc) Sandbox:
 *    - The container runs under gVisor's runsc runtime, which implements a virtualized
 *      user-space Linux kernel ("Sentry") that intercepts and verifies all application
 *      syscalls. Even if untrusted page scripts exploit a zero-day vulnerability in
 *      Chromium's V8 or rendering engine, they remain strictly trapped inside the
 *      userspace sandbox without direct access to host kernel syscalls.
 * 
 * 2. Hardened Chromium Flags:
 *    - '--no-sandbox' & '--disable-setuid-sandbox':
 *      Chromium's internal Linux user-namespace and setuid sandbox helpers conflict
 *      with containerized unprivileged environments and gVisor's syscall interception.
 *      Disabling the internal browser sandbox is secure here because gVisor delivers
 *      kernel-boundary isolation.
 *    - '--disable-gpu':
 *      Prevents hardware acceleration crashes, eliminates WebGL/GPU driver exploit
 *      vectors, and optimizes memory consumption in headless container runners.
 *    - '--disable-dev-shm-usage':
 *      Prevents Chromium crashes from Docker's default 64MB /dev/shm partition
 *      exhaustion by directing shared memory mappings to /tmp.
 *    - '--disable-extensions' & '--disable-plugins':
 *      Eliminates third-party extension injection and obsolete NPAPI/PPAPI/PDF plugin
 *      attack surfaces.
 *    - '--disable-background-networking':
 *      Suppresses Google telemetry, safe browsing updates, and auto-update network
 *      traffic, guaranteeing network activity is strictly scoped to the target crawl.
 *    - '--disable-sync':
 *      Disables Google account synchronization, credential stores, and sign-in sync.
 *    - '--disable-translate' & '--disable-features=TranslateUI':
 *      Prevents automated Google Translate UI injections that can corrupt or alter
 *      DOM pricing nodes.
 *    - '--no-first-run':
 *      Bypasses initial setup screens and splash dialogues.
 * 
 * 3. Request Interception & Anti-Tracking Firewall:
 *    - Inspects all outbound HTTP/HTTPS requests at the browser context level.
 *    - Aborts requests to known ad trackers, cryptominers, behavioral telemetry,
 *      and fingerprinting networks (Google Analytics, Criteo, Facebook Pixel, Hotjar,
 *      TikTok, etc.) to minimize exfiltration risk, boost speed, and conserve memory.
 *    - Drops heavy unneeded media streams (video/audio) while preserving essential
 *      stylesheets, fonts, and product image CDNs needed for accurate DOM layout.
 * ============================================================================
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { URL } from 'url';

// Read configuration from environment variables
const TARGET_URL = process.env.TARGET_URL;
const TASK_ID = process.env.TASK_ID || `task_${Date.now()}`;
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '50000', 10); // 50s (under 60s hard limit)

/**
 * Structured logger with ISO timestamp and standardized [GHOST] prefix
 * Captured by the orchestrator via Docker container stdout/stderr.
 * 
 * @param {string} step - The pipeline phase (e.g., LAUNCH, NAVIGATE, EXTRACT)
 * @param {string} message - Descriptive message
 * @param {any} [data=null] - Optional auxiliary data object
 */
function log(step, message, data = null) {
  const timestamp = new Date().toISOString();
  const dataSuffix = data ? ` | ${typeof data === 'object' ? JSON.stringify(data) : data}` : '';
  console.log(`[GHOST] [${timestamp}] [${step}] ${message}${dataSuffix}`);
}

/**
 * List of known tracking, analytics, and advertising domains to intercept and drop.
 * Prevents third-party trackers from profiling our bot or injecting malicious scripts.
 */
const TRACKER_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'googleadservices.com',
  'adservice.google.com',
  'facebook.net',
  'connect.facebook.net',
  'facebook.com/tr',
  'criteo.com',
  'criteo.net',
  'hotjar.com',
  'clarity.ms',
  'tiktok.com',
  'analytics.tiktok.com',
  'scorecardresearch.com',
  'outbrain.com',
  'taboola.com',
  'adnxs.com',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'chartbeat.com',
  'quantserve.com',
  'branch.io',
  'adjust.com',
  'appsflyer.com',
  'fullstory.com',
  'segment.io',
  'segment.com',
  'amplitude.com',
  'mixpanel.com',
  'optimizely.com'
];

/**
 * Selectors for cookie consent banners, privacy modals, and promotional overlays
 * across major e-commerce retailers and common CMPs (OneTrust, Cookiebot, etc.).
 */
const POPUP_DISMISS_SELECTORS = [
  // OneTrust & Cookiebot consent banners
  '#onetrust-accept-btn-handler',
  '#onetrust-reject-all-handler',
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  '#CybotCookiebotDialogBodyButtonAccept',
  
  // Amazon EU & Global Cookie banners
  '#sp-cc-accept',
  'input[name="acceptCookie"]',
  
  // Generic e-commerce cookie banners
  '#accept-cookies',
  '.cookie-banner button',
  '[class*="cookie"] button',
  '[id*="consent"] button',
  'button[id*="cookie" i]',
  'button[class*="cookie" i]',
  'button[aria-label*="cookie" i]',
  'button[data-testid*="cookie" i]',
  
  // High-confidence action button text matches
  'button:has-text("Accept All")',
  'button:has-text("Accept Cookies")',
  'button:has-text("Accept all cookies")',
  'button:has-text("I Accept")',
  'button:has-text("Allow All")',
  'button:has-text("Allow all cookies")',
  'button:has-text("I agree")',
  'button:has-text("Agree")',
  'button:has-text("Got it")',
  'button:has-text("Dismiss")',
  
  // Modal & Newsletter close buttons
  '[aria-label="Close" i]',
  '[aria-label="close" i]',
  '.modal-close',
  '.close-modal',
  'button.close',
  'button[data-action="close" i]',
  'button[data-automation-id="close-drawer"]',
  '[data-testid="close-button"]'
];

/**
 * Product Title selectors ordered by retail specificity and Schema.org standards.
 */
const PRODUCT_TITLE_SELECTORS = [
  // Amazon
  '#productTitle',
  '#title',
  
  // Walmart
  'h1[itemprop="name"]',
  'h1.inline-flex',
  '[data-testid="product-title"]',
  
  // Best Buy
  '.sku-title h1',
  'h1.heading-5',
  
  // Target
  '[data-test="product-title"]',
  'h1[data-test="product-title"]',
  
  // Newegg
  'h1.product-title',
  
  // Schema.org & OpenGraph standard metadata
  '[itemprop="name"]',
  'meta[property="og:title"]',
  'meta[name="twitter:title"]',
  
  // General e-commerce fallbacks
  '.product-title h1',
  '.product-title',
  '.product-name',
  '.product_title',
  '.title-wrap h1',
  '[data-automation="product-title"]',
  'h1'
];

/**
 * Current Price selectors ordered by retailer specificity.
 */
const CURRENT_PRICE_SELECTORS = [
  // Amazon
  '#corePrice_feature_div .a-price .a-offscreen',
  '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
  '.a-price.priceToPay .a-offscreen',
  '#priceblock_ourprice',
  '#priceblock_dealprice',
  '#priceblock_saleprice',
  '.a-price .a-offscreen',
  '.apexPriceToPay .a-offscreen',
  
  // Walmart
  'span[itemprop="price"]',
  '[itemprop="price"]',
  '[data-testid="price-wrap"] span',
  '[data-automation-id="product-price"]',
  
  // Best Buy
  '.priceView-customer-price span[aria-hidden="true"]',
  '.priceView-customer-price span',
  '[data-testid="customer-price"] span',
  
  // Target
  '[data-test="product-price"]',
  '[data-test="current-price"]',
  
  // Newegg
  '.price-current',
  '.price-current strong',
  
  // Schema.org & OpenGraph metadata
  'meta[property="product:price:amount"]',
  'meta[property="og:price:amount"]',
  
  // General e-commerce
  '[data-testid="price"]',
  '.product-price',
  '.price',
  '#price',
  '.current-price',
  '.sale-price',
  '.special-price',
  '.regular-price',
  '.offer-price',
  '.amount'
];

/**
 * Original / List / Compare Price selectors for discount computation.
 */
const ORIGINAL_PRICE_SELECTORS = [
  // Amazon
  '.a-price.a-text-price .a-offscreen',
  '#basisPrice .a-offscreen',
  '.basisPrice .a-offscreen',
  '#priceblock_wasprice',
  
  // Walmart
  '[data-testid="strikethrough-price"]',
  '.was-price',
  '.strike-price',
  
  // Best Buy
  '.pricing-price__regular-price',
  '.pricing-price__savings-price',
  
  // Target
  '[data-test="comparison-price"]',
  '[data-test="was-price"]',
  
  // General e-commerce
  'del',
  's',
  'strike',
  '.list-price',
  '.price-was',
  '.original-price',
  '.compare-at-price',
  '.regular-price-strikethrough'
];

/**
 * HITL (Human-in-the-Loop) selectors:
 * Detects CAPTCHAs, bot challenges, and multi-step checkout/login forms
 * requiring user intervention.
 */
const HITL_SELECTORS = [
  // CAPTCHA containers & iframes
  '[class*="captcha" i]',
  '[id*="captcha" i]',
  'iframe[src*="captcha" i]',
  'iframe[src*="recaptcha" i]',
  'iframe[src*="hcaptcha" i]',
  'iframe[src*="turnstile" i]',
  'iframe[src*="challenges.cloudflare" i]',
  '.g-recaptcha',
  '.h-captcha',
  '.cf-turnstile',
  '#px-captcha',
  '#datadome',
  '#captchacharacters', // Amazon robot check form
  
  // Multi-step Checkout / Login forms
  'form[action*="checkout" i]',
  'form[action*="cart" i]',
  'form[action*="signin" i]',
  'form[action*="login" i]'
];

/**
 * Parse currency and numerical value from a price string.
 * Supports $, £, €, ¥, CAD, USD, etc., and handles thousands separators.
 * 
 * @param {string} rawString 
 * @returns {{ parsedValue: number|null, currency: string|null }}
 */
function parsePrice(rawString) {
  if (!rawString || typeof rawString !== 'string') {
    return { parsedValue: null, currency: null };
  }

  const cleaned = rawString.trim();

  // Detect currency symbol or ISO code
  let currency = 'USD'; // Default
  if (cleaned.includes('£') || /GBP/i.test(cleaned)) {
    currency = 'GBP';
  } else if (cleaned.includes('€') || /EUR/i.test(cleaned)) {
    currency = 'EUR';
  } else if (cleaned.includes('¥') || /JPY/i.test(cleaned)) {
    currency = 'JPY';
  } else if (/CAD/i.test(cleaned)) {
    currency = 'CAD';
  } else if (/AUD/i.test(cleaned)) {
    currency = 'AUD';
  } else if (cleaned.includes('₹') || /INR/i.test(cleaned)) {
    currency = 'INR';
  } else if (cleaned.includes('$') || /USD/i.test(cleaned)) {
    currency = 'USD';
  }

  // Regex to extract numeric portion: handles commas and dots
  // Matches e.g. 1,299.99 or 1299.99 or European 19,99
  const match = cleaned.match(/[\$£€¥₹CADUSDGBPAUD\s]*([\d,]+\.?\d*)/i);
  if (!match || !match[1]) {
    return { parsedValue: null, currency };
  }

  let numStr = match[1].trim();

  // Handle European comma decimal (e.g. "19,99" with no dots)
  if (/^\d+,\d{2}$/.test(numStr)) {
    numStr = numStr.replace(',', '.');
  } else {
    // Standard format: remove thousand separator commas
    numStr = numStr.replace(/,/g, '');
  }

  const parsedValue = parseFloat(numStr);
  return {
    parsedValue: Number.isFinite(parsedValue) ? parsedValue : null,
    currency
  };
}

/**
 * Attempts to extract text or attribute content from a list of selectors.
 * 
 * @param {import('playwright').Page} page 
 * @param {string[]} selectors 
 * @returns {Promise<{ text: string|null, selectorMatched: string|null }>}
 */
async function extractFromSelectors(page, selectors) {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      const count = await locator.count();
      if (count === 0) continue;

      let value = null;

      // Handle meta tags where price/title is in content attribute
      if (selector.startsWith('meta[')) {
        value = await locator.getAttribute('content');
      } else {
        // Extract visible or inner text
        value = await locator.textContent();
      }

      if (value) {
        const trimmed = value.replace(/\s+/g, ' ').trim();
        if (trimmed.length > 0) {
          return { text: trimmed, selectorMatched: selector };
        }
      }
    } catch {
      // Continue to next selector if query fails
    }
  }

  return { text: null, selectorMatched: null };
}

/**
 * Main execution function.
 */
async function main() {
  const taskDir = path.join(WORKSPACE_DIR, TASK_ID);
  const screenshotFileName = 'screenshot.png';
  const screenshotPath = path.join(taskDir, screenshotFileName);
  const outputPath = path.join(taskDir, 'output.json');
  const approvalPath = path.join(taskDir, 'needs_approval.json');

  let browser = null;
  let context = null;
  let page = null;
  let screenshotSaved = false;

  // Track matched selectors for diagnostics
  const selectorsMatched = [];

  try {
    // ------------------------------------------------------------------------
    // Step 1: Setup Task Directory & Input Validation
    // ------------------------------------------------------------------------
    log('SETUP', `Initializing task workspace: ${taskDir}`);
    await fs.mkdir(taskDir, { recursive: true });

    if (!TARGET_URL) {
      throw new Error('TARGET_URL environment variable is required but was not provided.');
    }

    try {
      new URL(TARGET_URL);
    } catch {
      throw new Error(`Invalid TARGET_URL format: "${TARGET_URL}". Must be a valid HTTP/HTTPS URL.`);
    }

    // Set emergency execution timeout guard (fires 3 seconds before hard limit)
    const timeoutGuard = setTimeout(async () => {
      log('ERROR', `Hard execution timeout of ${TIMEOUT_MS}ms approaching. Terminating.`);
      try {
        const timeoutOutput = {
          task_id: TASK_ID,
          url: TARGET_URL,
          timestamp: new Date().toISOString(),
          error: true,
          error_message: `Script execution timed out after ${TIMEOUT_MS}ms`,
          screenshot: screenshotSaved ? screenshotFileName : null,
          needs_approval: false,
          approval_reason: null
        };
        await fs.writeFile(outputPath, JSON.stringify(timeoutOutput, null, 2), 'utf8');
      } catch (writeErr) {
        console.error('Failed to write timeout output:', writeErr);
      }
      process.exit(1);
    }, Math.max(TIMEOUT_MS - 3000, 5000));
    timeoutGuard.unref();

    // ------------------------------------------------------------------------
    // Step 2: Launch Sandboxed Chromium Browser
    // ------------------------------------------------------------------------
    log('LAUNCH', 'Launching Chromium with restricted sandboxing profile in gVisor container');

    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--no-sandbox',                // gVisor (runsc) provides user-space kernel isolation
        '--disable-setuid-sandbox',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-translate',
        '--disable-features=TranslateUI',
        '--no-first-run'
      ]
    });

    context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      }
    });

    // Mask standard automated navigator properties
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });
    });

    // Request interception: block tracking domains and excessive media streams
    await context.route('**/*', async (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const reqUrl = request.url();

      // Block heavy streaming media to conserve container memory
      if (resourceType === 'media') {
        return route.abort('blockedbyclient');
      }

      // Block known tracking and telemetry hosts
      const isTracker = TRACKER_DOMAINS.some((domain) => reqUrl.includes(domain));
      if (isTracker) {
        return route.abort('blockedbyclient');
      }

      return route.continue();
    });

    page = await context.newPage();

    // ------------------------------------------------------------------------
    // Step 3: Navigate to Target URL
    // ------------------------------------------------------------------------
    log('NAVIGATE', `Navigating to ${TARGET_URL} (timeout: 30000ms)`);

    try {
      await page.goto(TARGET_URL, {
        timeout: 30000,
        waitUntil: 'domcontentloaded'
      });
    } catch (navErr) {
      log('NAVIGATE', `Initial navigation reached timeout/error: ${navErr.message}. Attempting to process available DOM.`);
    }

    // Wait for network idle with short timeout to catch dynamic hydration (React, Next.js, etc.)
    try {
      await page.waitForLoadState('networkidle', { timeout: 6000 });
      log('NAVIGATE', 'Network idle state achieved');
    } catch {
      log('NAVIGATE', 'Network idle timeout passed; proceeding with existing DOM state');
    }

    // Brief stabilization pause for animations and dynamic price counters
    await page.waitForTimeout(1000);

    // ------------------------------------------------------------------------
    // Step 4: Cookie / Popup Dismissal
    // ------------------------------------------------------------------------
    log('DISMISS_POPUPS', 'Checking for cookie consent dialogues, banners, and modal overlays');

    let popupDismissed = false;
    for (const selector of POPUP_DISMISS_SELECTORS) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 400 })) {
          log('DISMISS_POPUPS', `Found interactive popup button matching: ${selector}`);
          await btn.click({ timeout: 1500 });
          popupDismissed = true;
          selectorsMatched.push(`popup_dismiss:${selector}`);
          break; // Stop once primary modal is dismissed
        }
      } catch {
        // Selector not matched or not interactable
      }
    }

    if (popupDismissed) {
      log('DISMISS_POPUPS', 'Popup dismissed successfully. Waiting 1000ms for DOM layout reflow');
      await page.waitForTimeout(1000);
    } else {
      log('DISMISS_POPUPS', 'No blocking popups or cookie dialogs detected');
    }

    // ------------------------------------------------------------------------
    // Step 5: Screenshot Capture
    // ------------------------------------------------------------------------
    log('SCREENSHOT', `Capturing full-page screenshot to: ${screenshotPath}`);

    try {
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
        timeout: 15000
      });
      screenshotSaved = true;
      log('SCREENSHOT', 'Full-page screenshot successfully saved');
    } catch (fullPageErr) {
      log('SCREENSHOT', `Full-page screenshot failed (${fullPageErr.message}). Capturing viewport fallback.`);
      try {
        await page.screenshot({
          path: screenshotPath,
          fullPage: false,
          timeout: 10000
        });
        screenshotSaved = true;
        log('SCREENSHOT', 'Viewport fallback screenshot saved');
      } catch (fallbackErr) {
        log('SCREENSHOT', `Failed to capture fallback screenshot: ${fallbackErr.message}`);
      }
    }

    // ------------------------------------------------------------------------
    // Step 6: Data Extraction (Tier 1 - Local)
    // ------------------------------------------------------------------------
    log('EXTRACT', 'Extracting product metadata, pricing, and discount details');

    const pageTitle = (await page.title()) || '';

    // Extract Product Title
    const titleResult = await extractFromSelectors(page, PRODUCT_TITLE_SELECTORS);
    const productTitle = titleResult.text || pageTitle || null;
    if (titleResult.selectorMatched) {
      selectorsMatched.push(`title:${titleResult.selectorMatched}`);
    }

    // Extract Current Price
    const priceResult = await extractFromSelectors(page, CURRENT_PRICE_SELECTORS);
    const rawPriceText = priceResult.text;
    if (priceResult.selectorMatched) {
      selectorsMatched.push(`current_price:${priceResult.selectorMatched}`);
    }

    const { parsedValue: currentPriceVal, currency } = parsePrice(rawPriceText);

    // Extract Original / Strikethrough Price (if available)
    const originalPriceResult = await extractFromSelectors(page, ORIGINAL_PRICE_SELECTORS);
    let originalPriceVal = null;
    if (originalPriceResult.text) {
      const parsedOriginal = parsePrice(originalPriceResult.text);
      originalPriceVal = parsedOriginal.parsedValue;
      if (originalPriceResult.selectorMatched) {
        selectorsMatched.push(`original_price:${originalPriceResult.selectorMatched}`);
      }
    }

    // Calculate Discount Percentage
    let discountPercent = null;
    if (
      currentPriceVal !== null &&
      originalPriceVal !== null &&
      originalPriceVal > currentPriceVal &&
      originalPriceVal > 0
    ) {
      discountPercent = Math.round(((originalPriceVal - currentPriceVal) / originalPriceVal) * 1000) / 10;
    }

    // Anomaly Detection
    const anomalies = [];

    if (!rawPriceText || currentPriceVal === null) {
      anomalies.push('price_not_found');
    } else if (currentPriceVal === 0) {
      anomalies.push('price_is_zero');
    } else if (currentPriceVal < 0.05) {
      anomalies.push('price_impossibly_low');
    } else if (currentPriceVal > 100000) {
      anomalies.push('price_impossibly_high');
    }

    if (discountPercent !== null && discountPercent > 90) {
      anomalies.push('discount_exceeds_90_percent');
    }

    if (originalPriceVal !== null && currentPriceVal !== null && currentPriceVal > originalPriceVal) {
      anomalies.push('inverted_discount_current_greater_than_original');
    }

    if (!productTitle) {
      anomalies.push('product_title_missing');
    }

    log('EXTRACT', 'Extraction completed', {
      title: productTitle ? productTitle.slice(0, 50) + '...' : null,
      price: currentPriceVal,
      currency,
      originalPrice: originalPriceVal,
      discount: discountPercent,
      anomalies
    });

    // ------------------------------------------------------------------------
    // Step 7: HITL (Human-in-the-Loop) Detection
    // ------------------------------------------------------------------------
    log('HITL_CHECK', 'Scanning DOM for bot challenges, CAPTCHAs, or checkout gateways');

    let needsApproval = false;
    let approvalReason = null;
    const detectedTriggers = [];

    // Check DOM for CAPTCHA & Form selectors
    for (const hitlSel of HITL_SELECTORS) {
      try {
        const el = page.locator(hitlSel).first();
        if (await el.isVisible({ timeout: 200 })) {
          detectedTriggers.push(`selector:${hitlSel}`);
        }
      } catch {
        // Element not present
      }
    }

    // Check Page Title for challenge keywords
    const lowerTitle = pageTitle.toLowerCase();
    const challengeKeywords = ['robot check', 'captcha', 'security check', 'just a moment...', 'access denied', 'verification required'];
    for (const kw of challengeKeywords) {
      if (lowerTitle.includes(kw)) {
        detectedTriggers.push(`title_keyword:${kw}`);
      }
    }

    if (detectedTriggers.length > 0) {
      needsApproval = true;
      approvalReason = `Interactive intervention required: detected [${detectedTriggers.join(', ')}]`;
      log('HITL_CHECK', `HITL trigger activated! Reason: ${approvalReason}`);

      // Write special needs_approval.json trigger file monitored by the orchestrator
      const approvalPayload = {
        task_id: TASK_ID,
        timestamp: new Date().toISOString(),
        reason: approvalReason,
        triggers: detectedTriggers,
        url: TARGET_URL,
        screenshot: screenshotSaved ? screenshotFileName : null
      };

      await fs.writeFile(approvalPath, JSON.stringify(approvalPayload, null, 2), 'utf8');
      log('HITL_CHECK', `Wrote approval trigger file to: ${approvalPath}`);
    } else {
      log('HITL_CHECK', 'No HITL intervention required; automated pipeline proceeding');
    }

    // ------------------------------------------------------------------------
    // Step 8: Structured Output Generation
    // ------------------------------------------------------------------------
    log('OUTPUT', `Writing structured extraction result to: ${outputPath}`);

    const resultOutput = {
      task_id: TASK_ID,
      url: TARGET_URL,
      timestamp: new Date().toISOString(),
      product_title: productTitle,
      price: {
        raw_text: rawPriceText,
        parsed_value: currentPriceVal,
        currency,
        original_price: originalPriceVal,
        discount_percent: discountPercent
      },
      anomalies,
      needs_approval: needsApproval,
      approval_reason: approvalReason,
      screenshot: screenshotSaved ? screenshotFileName : null,
      page_title: pageTitle,
      extraction_method: 'css_selector',
      selectors_matched: selectorsMatched
    };

    await fs.writeFile(outputPath, JSON.stringify(resultOutput, null, 2), 'utf8');
    log('COMPLETE', `Scraping process finished successfully for Task: ${TASK_ID}`);

    // Clean exit
    process.exit(0);

  } catch (err) {
    // ------------------------------------------------------------------------
    // Step 9: Error Handling
    // ------------------------------------------------------------------------
    log('ERROR', `Uncaught exception in scraper: ${err.message}`, { stack: err.stack });

    try {
      const errorPayload = {
        task_id: TASK_ID,
        url: TARGET_URL || null,
        timestamp: new Date().toISOString(),
        error: true,
        error_message: err.message,
        error_stack: err.stack,
        product_title: null,
        price: {
          raw_text: null,
          parsed_value: null,
          currency: null,
          original_price: null,
          discount_percent: null
        },
        anomalies: ['fatal_scraper_error'],
        needs_approval: false,
        approval_reason: null,
        screenshot: screenshotSaved ? screenshotFileName : null,
        page_title: null,
        extraction_method: 'none',
        selectors_matched: selectorsMatched
      };

      await fs.writeFile(outputPath, JSON.stringify(errorPayload, null, 2), 'utf8');
      log('OUTPUT', `Wrote error response to: ${outputPath}`);
    } catch (writeErr) {
      console.error('[GHOST] CRITICAL: Failed to write error output.json:', writeErr);
    }

    process.exit(1);

  } finally {
    // ------------------------------------------------------------------------
    // Step 10: Resource Cleanup
    // ------------------------------------------------------------------------
    log('CLEANUP', 'Releasing browser and context resources');
    try {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    } catch (cleanupErr) {
      console.error('[GHOST] Error during browser teardown:', cleanupErr);
    }
  }
}

// Execute worker
main();
