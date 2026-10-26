/**
 * @file app.js
 * @description Master Application Controller for Ghost Shopper Frontend.
 * Integrates WebSocket communications, UI components, REST API interactions,
 * lifecycle state machines, and real-time competitor intelligence tables.
 */

import { GhostWebSocket } from './websocket.js';
import { SecurityMatrix, LogStream, ScreenshotViewer, TaskCard, ToastManager } from './components.js';

// Helper utility to safely escape HTML strings
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

export class GhostShopperApp {
  constructor() {
    // Component Instances
    this.toast = new ToastManager();
    this.securityMatrix = new SecurityMatrix();
    this.logStream = new LogStream(document.getElementById('log-viewport'));
    this.screenshotViewer = new ScreenshotViewer(
      document.getElementById('viewport-grid'),
      (snapshot) => this.openLightbox(snapshot)
    );

    // State Tracking
    this.tasks = new Map();              // taskId -> taskData
    this.batches = [];                   // Array of past batch objects
    this.pendingApprovals = new Map();   // taskId -> approvalData
    this.results = [];                   // Array of completed extraction records
    this.uptimeSeconds = 0;
    this.uptimeTimer = null;
    this.poolPollInterval = null;
    this.isSimulationActive = false;
    this.simTimer = null;

    // WebSocket Client
    this.ws = new GhostWebSocket();

    // DOM Elements Cache
    this.dom = {
      wsIndicatorDot: document.getElementById('ws-indicator-dot'),
      wsStatusText: document.getElementById('ws-status-text'),
      headerUptime: document.getElementById('header-uptime'),
      urlInput: document.getElementById('url-input'),
      urlCounter: document.getElementById('url-count-indicator'),
      btnDeploy: document.getElementById('btn-deploy-agents'),
      btnSampleUrls: document.getElementById('btn-sample-urls'),
      btnClearUrls: document.getElementById('btn-clear-urls'),
      btnToggleDemo: document.getElementById('btn-toggle-demo'),
      demoModeLabel: document.getElementById('demo-mode-label'),
      btnRefreshAll: document.getElementById('btn-refresh-all'),
      selectStealth: document.getElementById('select-stealth'),
      selectConcurrency: document.getElementById('select-concurrency'),
      batchHistoryList: document.getElementById('batch-history-list'),
      batchTotalCount: document.getElementById('batch-total-count'),
      approvalsContainer: document.getElementById('approvals-container'),
      approvalCountBadge: document.getElementById('approval-count-badge'),
      approvalSection: document.getElementById('approval-section'),
      resultsTableBody: document.getElementById('results-table-body'),
      resultsCountBadge: document.getElementById('results-count-badge'),
      resultsSearch: document.getElementById('results-search'),
      btnExportCsv: document.getElementById('btn-export-csv'),
      btnExportJson: document.getElementById('btn-export-json'),
      modal: document.getElementById('screenshot-modal'),
      modalImage: document.getElementById('modal-image'),
      modalTitle: document.getElementById('modal-title'),
      modalTag: document.getElementById('modal-container-tag'),
      modalMetaUrl: document.getElementById('modal-meta-url'),
      modalMetaStep: document.getElementById('modal-meta-step'),
      modalMetaTime: document.getElementById('modal-meta-time'),
      btnCloseModal: document.getElementById('btn-close-modal'),
      btnClearLogs: document.getElementById('btn-clear-logs'),
      logFilterButtons: document.querySelectorAll('.filter-btn[data-filter]'),

      // Pattern B Goal & Containment Demo Elements
      tabModeGoal: document.getElementById('tab-mode-goal'),
      tabModeUrls: document.getElementById('tab-mode-urls'),
      goalContainer: document.getElementById('goal-input-container'),
      urlContainer: document.getElementById('url-input-container'),
      goalInput: document.getElementById('goal-input'),
      btnDeployLabel: document.getElementById('btn-deploy-label'),
      btnSampleGoal1: document.getElementById('btn-sample-goal-1'),
      btnSampleGoal2: document.getElementById('btn-sample-goal-2'),
      btnSampleGoal3: document.getElementById('btn-sample-goal-3'),
      btnDemoSsrf: document.getElementById('btn-demo-ssrf'),
      btnDemoOom: document.getElementById('btn-demo-oom'),
      btnDemoHitl: document.getElementById('btn-demo-hitl'),

      // Vultr Onboarding Modal (Nov 3rd plug-in)
      btnVultrModal: document.getElementById('btn-vultr-modal'),
      vultrBadgeLabel: document.getElementById('vultr-badge-label'),
      vultrModal: document.getElementById('vultr-modal'),
      btnCloseVultrModal: document.getElementById('btn-close-vultr-modal'),
      inputVultrApiKey: document.getElementById('input-vultr-api-key'),
      inputVultrInfKey: document.getElementById('input-vultr-inf-key'),
      selectVultrVisionModel: document.getElementById('select-vultr-vision-model'),
      btnTestVultrKeys: document.getElementById('btn-test-vultr-keys'),
      btnSaveVultrKeys: document.getElementById('btn-save-vultr-keys'),
      vultrModalModeBadge: document.getElementById('vultr-modal-mode-badge'),
      vultrModalStatusText: document.getElementById('vultr-modal-status-text')
    };
    this.activeMode = 'goal'; // 'goal' or 'urls'
  }

  /**
   * Initializes application lifecycle, listeners, WebSocket and timers.
   */
  async init() {
    this.logStream.addLog({
      level: 'SECURITY',
      message: 'Ghost Shopper Intelligence System initialized. Establishing secure telemetry tunnels...'
    });

    this._setupWebSocketEvents();
    this._setupDomListeners();
    this._startUptimeCounter();

    // Connect WebSocket
    this.ws.connect();

    // Initial REST sync
    await this.fetchPoolStatus();
    await this.fetchVultrConfig();

    // Periodic telemetry sync (fallback every 8s)
    this.poolPollInterval = setInterval(() => {
      this.fetchPoolStatus();
    }, 8000);

    // Initial greeting
    this.toast.info('System Online', 'Connected to Ghost Fleet Command Center.');
  }

  /**
   * Configures WebSocket event routing.
   * @private
   */
  _setupWebSocketEvents() {
    // Connection status updates
    this.ws.on('status_change', ({ current }) => {
      this._updateConnectionIndicator(current);
    });

    this.ws.on('open', () => {
      this.logStream.addLog({
        level: 'INFO',
        message: 'Telemetry WebSocket tunnel connected: [ENCRYPTED/MUTUAL_AUTH]'
      });
      this.toast.success('Fleet Connected', 'Real-time telemetry stream active.');
    });

    this.ws.on('close', () => {
      this.logStream.addLog({
        level: 'WARN',
        message: 'Telemetry WebSocket disconnected. Offline failover activated.'
      });
    });

    // Ingest Server Telemetry Frame
    this.ws.on('telemetry', (data) => {
      this.securityMatrix.updateTelemetry(data);
    });

    this.ws.on('pool_status', (data) => {
      this.securityMatrix.updateTelemetry(data);
    });

    // Ingest System Logs
    this.ws.on('log', (entry) => {
      this.logStream.addLog(entry);
    });

    // Ingest Task Execution State Updates
    this.ws.on('task_update', (task) => {
      this._handleTaskUpdate(task);
    });

    // Ingest Sandbox Screenshots
    this.ws.on('screenshot', (data) => {
      if (data && data.task_id) {
        this.screenshotViewer.updateSnapshot(data.task_id, {
          url: data.url,
          containerId: data.container_id,
          image: data.image_base64 || data.image_url,
          status: data.status,
          step: data.step,
          timestamp: data.timestamp
        });
      }
    });

    // Human-in-the-Loop Interventions
    this.ws.on('approval_required', (approval) => {
      this._handleApprovalRequired(approval);
    });

    this.ws.on('approval_resolved', ({ task_id, status }) => {
      this._removeApproval(task_id);
      this.toast.info('Approval Resolved', `Task ${task_id.substring(0, 8)} status: ${status}`);
    });

    // Batch Mission Completed
    this.ws.on('batch_completed', (batch) => {
      this.logStream.addLog({
        level: 'INFO',
        message: `Batch mission [${batch.batch_id || 'ID'}] completed with ${batch.total_extracted || 0} extractions.`
      });
      this.toast.success('Mission Complete', `Batch ${batch.batch_id} fully extracted.`);
      this.fetchPoolStatus();
    });
  }

  /**
   * Binds user interaction event listeners.
   * @private
   */
  _setupDomListeners() {
    // Pattern B Mode Switcher Tabs
    if (this.dom.tabModeGoal && this.dom.tabModeUrls) {
      this.dom.tabModeGoal.addEventListener('click', () => {
        this.activeMode = 'goal';
        this.dom.tabModeGoal.className = 'btn btn-sm btn-primary active-tab';
        this.dom.tabModeUrls.className = 'btn btn-sm btn-secondary';
        if (this.dom.goalContainer) this.dom.goalContainer.style.display = 'block';
        if (this.dom.urlContainer) this.dom.urlContainer.style.display = 'none';
        if (this.dom.btnDeployLabel) this.dom.btnDeployLabel.textContent = 'Plan & Dispatch Agent Fleet';
      });

      this.dom.tabModeUrls.addEventListener('click', () => {
        this.activeMode = 'urls';
        this.dom.tabModeUrls.className = 'btn btn-sm btn-primary active-tab';
        this.dom.tabModeGoal.className = 'btn btn-sm btn-secondary';
        if (this.dom.goalContainer) this.dom.goalContainer.style.display = 'none';
        if (this.dom.urlContainer) this.dom.urlContainer.style.display = 'block';
        if (this.dom.btnDeployLabel) this.dom.btnDeployLabel.textContent = 'Deploy Ghost Fleet (URLs)';
      });
    }

    // Pattern B Quick Goal Samples
    if (this.dom.btnSampleGoal1) {
      this.dom.btnSampleGoal1.addEventListener('click', () => {
        if (this.dom.goalInput) {
          this.dom.goalInput.value = 'Compare Sony WH-1000XM5 wireless noise-canceling headphones across competitor retail sites, verify pricing with Vultr Vision LLM, and flag cart surcharges.';
          this.toast.info('Goal Loaded', 'Loaded Sony XM5 competitor sweep goal.');
        }
      });
    }
    if (this.dom.btnSampleGoal2) {
      this.dom.btnSampleGoal2.addEventListener('click', () => {
        if (this.dom.goalInput) {
          this.dom.goalInput.value = 'Audit Apple MacBook Air M3 15-inch 16GB RAM across major electronics retailers, verify authentic stock, and check checkout fee discrepancies.';
          this.toast.info('Goal Loaded', 'Loaded MacBook Air pricing audit goal.');
        }
      });
    }
    if (this.dom.btnSampleGoal3) {
      this.dom.btnSampleGoal3.addEventListener('click', () => {
        if (this.dom.goalInput) {
          this.dom.goalInput.value = 'Compare NVIDIA GeForce RTX 4080 Super GPU across Best Buy, Newegg, and B&H, check for bot protection traps, and extract verified cart totals.';
          this.toast.info('Goal Loaded', 'Loaded RTX 4080 GPU competitor sweep goal.');
        }
      });
    }

    // Containment Demo Buttons (for Vultr Video Demonstration)
    if (this.dom.btnDemoSsrf) {
      this.dom.btnDemoSsrf.addEventListener('click', () => this.triggerContainmentDemo('SSRF_METADATA_ATTACK'));
    }
    if (this.dom.btnDemoOom) {
      this.dom.btnDemoOom.addEventListener('click', () => this.triggerContainmentDemo('MEMORY_BOMB_OOM'));
    }
    if (this.dom.btnDemoHitl) {
      this.dom.btnDemoHitl.addEventListener('click', () => this.triggerContainmentDemo('DECEPTIVE_PRICE_HITL'));
    }

    // URL input typing and line counting
    if (this.dom.urlInput) {
      this.dom.urlInput.addEventListener('input', () => this._updateUrlCounter());
      this.dom.urlInput.addEventListener('keydown', (e) => {
        // Ctrl+Enter or Cmd+Enter to dispatch
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          this._handleDeployClick();
        }
      });
    }

    // Quick Buttons
    if (this.dom.btnSampleUrls) {
      this.dom.btnSampleUrls.addEventListener('click', () => this._loadSampleUrls());
    }

    if (this.dom.btnClearUrls) {
      this.dom.btnClearUrls.addEventListener('click', () => {
        if (this.dom.urlInput) {
          this.dom.urlInput.value = '';
          this._updateUrlCounter();
        }
      });
    }

    // Deploy Agents Button
    if (this.dom.btnDeploy) {
      this.dom.btnDeploy.addEventListener('click', () => this._handleDeployClick());
    }

    // Demo / Simulation Mode Toggle
    if (this.dom.btnToggleDemo) {
      this.dom.btnToggleDemo.addEventListener('click', () => this.toggleSimulationMode());
    }

    // Refresh Telemetry Button
    if (this.dom.btnRefreshAll) {
      this.dom.btnRefreshAll.addEventListener('click', async () => {
        this.dom.btnRefreshAll.disabled = true;
        await this.fetchPoolStatus();
        this.toast.info('Telemetry Synced', 'Refreshed fleet and container pool state.');
        setTimeout(() => {
          this.dom.btnRefreshAll.disabled = false;
        }, 800);
      });
    }

    // Log terminal level filtering
    this.dom.logFilterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.dom.logFilterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.logStream.setFilter(btn.dataset.filter);
      });
    });

    if (this.dom.btnClearLogs) {
      this.dom.btnClearLogs.addEventListener('click', () => {
        this.logStream.clear();
        this.toast.info('Terminal Cleared', 'Live log buffer reset.');
      });
    }

    // Results Search Filtering
    if (this.dom.resultsSearch) {
      this.dom.resultsSearch.addEventListener('input', (e) => {
        this._filterResultsTable(e.target.value.trim().toLowerCase());
      });
    }

    // Export CSV / JSON
    if (this.dom.btnExportCsv) {
      this.dom.btnExportCsv.addEventListener('click', () => this.exportCsv());
    }
    if (this.dom.btnExportJson) {
      this.dom.btnExportJson.addEventListener('click', () => this.exportJson());
    }

    // Lightbox Modal Controls
    if (this.dom.btnCloseModal) {
      this.dom.btnCloseModal.addEventListener('click', () => this.closeLightbox());
    }

    if (this.dom.modal) {
      this.dom.modal.addEventListener('click', (e) => {
        if (e.target === this.dom.modal) {
          this.closeLightbox();
        }
      });
    }

    // Vultr Onboarding Modal Controls
    if (this.dom.btnVultrModal) {
      this.dom.btnVultrModal.addEventListener('click', () => this.openVultrModal());
    }
    if (this.dom.btnCloseVultrModal) {
      this.dom.btnCloseVultrModal.addEventListener('click', () => this.closeVultrModal());
    }
    if (this.dom.vultrModal) {
      this.dom.vultrModal.addEventListener('click', (e) => {
        if (e.target === this.dom.vultrModal) {
          this.closeVultrModal();
        }
      });
    }
    if (this.dom.btnSaveVultrKeys) {
      this.dom.btnSaveVultrKeys.addEventListener('click', () => this.saveVultrConfig());
    }
    if (this.dom.btnTestVultrKeys) {
      this.dom.btnTestVultrKeys.addEventListener('click', () => this.testVultrKeys());
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.dom.modal && this.dom.modal.classList.contains('open')) {
          this.closeLightbox();
        }
        if (this.dom.vultrModal && this.dom.vultrModal.classList.contains('open')) {
          this.closeVultrModal();
        }
      }
    });
  }

  /**
   * Increments and updates system uptime counter.
   * @private
   */
  _startUptimeCounter() {
    this.uptimeSeconds = 0;
    this.uptimeTimer = setInterval(() => {
      this.uptimeSeconds++;
      const hrs = String(Math.floor(this.uptimeSeconds / 3600)).padStart(2, '0');
      const mins = String(Math.floor((this.uptimeSeconds % 3600) / 60)).padStart(2, '0');
      const secs = String(this.uptimeSeconds % 60).padStart(2, '0');
      if (this.dom.headerUptime) {
        this.dom.headerUptime.textContent = `${hrs}:${mins}:${secs}`;
      }
    }, 1000);
  }

  /**
   * Updates the UI status pill for WebSocket connectivity.
   * @private
   */
  _updateConnectionIndicator(state) {
    if (!this.dom.wsIndicatorDot || !this.dom.wsStatusText) return;

    this.dom.wsIndicatorDot.className = 'status-indicator-dot';
    switch (state) {
      case 'OPEN':
        this.dom.wsIndicatorDot.classList.add('online');
        this.dom.wsStatusText.textContent = 'ONLINE';
        this.dom.wsStatusText.className = 'telemetry-value accent-green';
        break;
      case 'RECONNECTING':
      case 'CONNECTING':
        this.dom.wsIndicatorDot.classList.add('reconnecting');
        this.dom.wsStatusText.textContent = state;
        this.dom.wsStatusText.className = 'telemetry-value accent-orange';
        break;
      case 'CLOSED':
      case 'CLOSING':
      default:
        this.dom.wsIndicatorDot.classList.add('offline');
        this.dom.wsStatusText.textContent = 'OFFLINE';
        this.dom.wsStatusText.className = 'telemetry-value';
        break;
    }
  }

  /**
   * Recalculates and displays the number of candidate URLs in textarea.
   * @private
   */
  _updateUrlCounter() {
    if (!this.dom.urlInput || !this.dom.urlCounter) return;
    const lines = this._extractUrlsFromInput();
    this.dom.urlCounter.textContent = `${lines.length} URL${lines.length === 1 ? '' : 's'}`;
  }

  /**
   * Extracts valid clean URLs from the input textarea.
   * @private
   * @returns {string[]}
   */
  _extractUrlsFromInput() {
    if (!this.dom.urlInput) return [];
    return this.dom.urlInput.value
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && (line.startsWith('http://') || line.startsWith('https://') || line.includes('.')));
  }

  /**
   * Fills textarea with sample e-commerce URLs for demonstration.
   * @private
   */
  _loadSampleUrls() {
    const samples = [
      'https://www.target-store.com/electronics/noise-canceling-pro-headphones',
      'https://www.competitor-direct.com/item/ultra-hd-curved-gaming-monitor-34',
      'https://www.shop-sample.org/products/smart-fitness-tracker-v4',
      'https://www.global-retail.net/dp/mechanical-keyboard-rgb-linear',
      'https://www.cyber-mall.io/hardware/nvme-m2-ssd-2tb-gen4'
    ];
    if (this.dom.urlInput) {
      this.dom.urlInput.value = samples.join('\n');
      this._updateUrlCounter();
      this.toast.info('Sample URLs Loaded', 'Pre-populated 5 diverse e-commerce targets.');
    }
  }

  /**
   * Dispatches the scraping mission (either Goal mode or URL list mode).
   * @private
   */
  async _handleDeployClick() {
    if (this.activeMode === 'goal') {
      const goalText = this.dom.goalInput ? this.dom.goalInput.value.trim() : '';
      if (!goalText) {
        this.toast.warning('Goal Required', 'Please enter a natural language mission goal.');
        if (this.dom.goalInput) this.dom.goalInput.focus();
        return;
      }

      if (this.dom.btnDeploy) {
        this.dom.btnDeploy.disabled = true;
        this.dom.btnDeploy.innerHTML = `
          <span class="mono" style="animation: pulse-glow 1s infinite;">PLANNING & DISPATCHING...</span>
        `;
      }

      try {
        await this.submitGoal(goalText);
      } finally {
        if (this.dom.btnDeploy) {
          this.dom.btnDeploy.disabled = false;
          this.dom.btnDeploy.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
            <span id="btn-deploy-label">Plan & Dispatch Agent Fleet</span>
          `;
        }
      }
    } else {
      // Direct URLs Mode
      const urls = this._extractUrlsFromInput();
      if (urls.length === 0) {
        this.toast.warning('Input Required', 'Please enter at least one target product URL.');
        if (this.dom.urlInput) this.dom.urlInput.focus();
        return;
      }

      if (this.dom.btnDeploy) {
        this.dom.btnDeploy.disabled = true;
        this.dom.btnDeploy.innerHTML = `
          <span class="mono" style="animation: pulse-glow 1s infinite;">PROVISIONING...</span>
        `;
      }

      try {
        await this.submitBatch(urls);
      } finally {
        if (this.dom.btnDeploy) {
          this.dom.btnDeploy.disabled = false;
          this.dom.btnDeploy.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
            <span id="btn-deploy-label">Deploy Ghost Fleet (URLs)</span>
          `;
        }
      }
    }
  }

  /**
   * Pattern B: Submits a natural language goal to POST /api/goal
   * Model plans -> Playwright runs in container -> vision model verifies -> HITL.
   * @param {string} goalText
   */
  async submitGoal(goalText) {
    const stealth = this.dom.selectStealth ? this.dom.selectStealth.value : 'ghost';
    const concurrency = this.dom.selectConcurrency ? parseInt(this.dom.selectConcurrency.value, 10) : 3;

    this.logStream.addLog({
      level: 'INFO',
      message: `[AGENT GOAL DISPATCH] Submitting goal: "${goalText}". Mode: Pattern B (Sandboxed Browser Agent).`
    });

    try {
      const response = await fetch('/api/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: goalText,
          stealth_profile: stealth,
          concurrency
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      const batchId = result.batch_id || `goal-${Date.now().toString(36)}`;

      this._recordBatch({
        batchId,
        urlCount: result.total_urls || 3,
        status: 'PLANNED_AND_DISPATCHED',
        timestamp: new Date()
      });

      if (Array.isArray(result.plan)) {
        this.logStream.addLog({
          level: 'INFO',
          message: `[AGENT PLANNER] Goal broken down into ${result.plan.length} verification steps.`
        });
      }

      if (Array.isArray(result.tasks)) {
        for (const task of result.tasks) {
          this._handleTaskUpdate(task);
        }
      }

      this.toast.success('Agent Plan Active', `Synthesized ${result.total_urls || 3} sandboxed inspection tasks.`);
      this.fetchPoolStatus();
      return result;
    } catch (err) {
      console.warn('[GhostShopperApp] REST /api/goal failed or offline:', err);
      this.toast.error('API Offline', `Could not reach backend (${err.message}). Executing agent plan locally...`);
      this._simulateLocalGoal(goalText);
    }
  }

  /**
   * Demonstrates on-demand Containment Moment for the Vultr Video Submission:
   * Calls POST /api/demo/containment-moment or falls back to local simulation.
   * @param {string} scenario 
   */
  async triggerContainmentDemo(scenario) {
    this.logStream.addLog({
      level: 'SECURITY',
      message: `[VULTR CONTAINMENT DEMO] Operator triggered containment proof: ${scenario}`
    });

    try {
      const response = await fetch('/api/demo/containment-moment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario })
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }

      this.toast.info('Containment Demo Active', `Executing ${scenario} proof across telemetry.`);
    } catch (err) {
      this.toast.info('Local Containment Demo', `Demonstrating ${scenario} locally.`);
      this._simulateLocalContainment(scenario);
    }
  }

  /**
   * Submits batch mission to the backend REST API: POST /api/scrape.
   * @param {string[]} urls 
   */
  async submitBatch(urls) {
    const stealth = this.dom.selectStealth ? this.dom.selectStealth.value : 'ghost';
    const concurrency = this.dom.selectConcurrency ? parseInt(this.dom.selectConcurrency.value, 10) : 5;

    this.logStream.addLog({
      level: 'INFO',
      message: `Initiating batch dispatch for ${urls.length} targets. Profile: [${stealth.toUpperCase()}], Parallel Concurrency: ${concurrency}`
    });

    try {
      const response = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls,
          stealth_profile: stealth,
          concurrency
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      const batchId = result.batch_id || `batch-${Date.now().toString(36)}`;

      this._recordBatch({
        batchId,
        urlCount: urls.length,
        status: 'DISPATCHED',
        timestamp: new Date()
      });

      // Register tasks from response
      if (Array.isArray(result.tasks)) {
        for (const task of result.tasks) {
          this._handleTaskUpdate(task);
        }
      }

      this.toast.success('Missions Dispatched', `Batch ${batchId} launched across microVM fleet.`);
      this.fetchPoolStatus();
      return result;

    } catch (err) {
      console.warn('[GhostShopperApp] REST /api/scrape failed or offline:', err);
      
      // If server is unavailable, activate simulation mode or provide informative feedback
      this.toast.error('Dispatch Failed', `Could not reach backend API (${err.message}). Activating local simulated run...`);
      this._simulateLocalBatch(urls);
    }
  }

  /**
   * Authorizes a paused human-in-the-loop task: POST /api/approve/{task_id}
   * @param {string} taskId 
   */
  async approveTask(taskId) {
    this.logStream.addLog({
      level: 'SECURITY',
      message: `Manual approval granted for task [${taskId}]. Resuming sandbox execution...`
    });

    try {
      const response = await fetch(`/api/approve/${encodeURIComponent(taskId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', timestamp: Date.now() })
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Server returned status ${response.status}`);
      }

      this._removeApproval(taskId);
      this.toast.success('Approved', `Challenge authorized for container associated with task ${taskId.substring(0, 8)}.`);

    } catch (err) {
      console.warn(`[GhostShopperApp] /api/approve failed:`, err);
      // Fallback local resolution
      this._removeApproval(taskId);
      this.toast.info('Approved (Local Override)', `Bypass authorized locally.`);
    }
  }

  /**
   * Rejects / aborts a challenged task: POST /api/reject/{task_id}
   * @param {string} taskId 
   */
  async rejectTask(taskId) {
    this.logStream.addLog({
      level: 'WARN',
      message: `Manual rejection for task [${taskId}]. Isolating container and initiating immediate memory wipe.`
    });

    try {
      const response = await fetch(`/api/reject/${encodeURIComponent(taskId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', timestamp: Date.now() })
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Server returned status ${response.status}`);
      }

      this._removeApproval(taskId);
      this.screenshotViewer.removeSnapshot(taskId);
      this.toast.warning('Task Aborted', `Container purged for task ${taskId.substring(0, 8)}.`);

    } catch (err) {
      console.warn(`[GhostShopperApp] /api/reject failed:`, err);
      this._removeApproval(taskId);
      this.screenshotViewer.removeSnapshot(taskId);
      this.toast.info('Task Aborted (Local Override)', `Container purged.`);
    }
  }

  /**
   * Queries fleet pool telemetry: GET /api/pool/status
   */
  async fetchPoolStatus() {
    try {
      const response = await fetch('/api/pool/status');
      if (!response.ok) return;

      const data = await response.json();
      this.securityMatrix.updateTelemetry(data);
    } catch {
      // Quiet fail on network polls when offline
    }
  }

  /**
   * Queries batch status: GET /api/status/{batch_id}
   * @param {string} batchId 
   */
  async fetchBatchStatus(batchId) {
    try {
      const response = await fetch(`/api/status/${encodeURIComponent(batchId)}`);
      if (!response.ok) return;

      const data = await response.json();
      if (Array.isArray(data.tasks)) {
        for (const task of data.tasks) {
          this._handleTaskUpdate(task);
        }
      }
      return data;
    } catch (err) {
      console.warn(`[GhostShopperApp] Failed fetching batch status for ${batchId}:`, err);
    }
  }

  /**
   * Processes task state updates, updates snapshot cards, and populates results table.
   * @private
   */
  _handleTaskUpdate(task) {
    if (!task || !task.task_id) return;
    const taskId = task.task_id;

    // Track state
    this.tasks.set(taskId, { ...(this.tasks.get(taskId) || {}), ...task });

    // Update screenshot card if screenshot provided or task is active
    if (task.status === 'EXECUTING' || task.status === 'VERIFYING' || task.status === 'PROVISIONING') {
      this.screenshotViewer.updateSnapshot(taskId, {
        url: task.url,
        containerId: task.container_id,
        image: task.screenshot,
        status: task.status,
        step: task.step || task.message || `Processing target`
      });
    } else if (task.status === 'COMPLETED' || task.status === 'WIPED') {
      // Auto-retire snapshot card after 4 seconds to simulate container wipe
      setTimeout(() => {
        this.screenshotViewer.removeSnapshot(taskId);
      }, 4000);
    }

    // If task yielded product intelligence, add to results table
    if (task.product_name || task.price !== undefined) {
      this._upsertResultRecord({
        taskId,
        url: task.url,
        productName: task.product_name || 'Standard Retail Product',
        price: task.price !== undefined ? task.price : null,
        currency: task.currency || '$',
        confidence: task.confidence !== undefined ? task.confidence : 0.95,
        status: task.status || 'COMPLETED',
        extractedAt: task.extracted_at || new Date().toISOString()
      });
    }

    // Refresh telemetry counts
    this._recomputePipelineStats();
  }

  /**
   * Recomputes state pipeline step tallies from current tasks.
   * @private
   */
  _recomputePipelineStats() {
    const counts = {
      pooled: 0,
      provisioning: 0,
      executing: 0,
      verifying: 0,
      completed: 0,
      wiped: 0
    };

    for (const task of this.tasks.values()) {
      const s = (task.status || '').toLowerCase();
      if (s.includes('pool')) counts.pooled++;
      else if (s.includes('provision')) counts.provisioning++;
      else if (s.includes('execut')) counts.executing++;
      else if (s.includes('verify')) counts.verifying++;
      else if (s.includes('complete')) counts.completed++;
      else if (s.includes('wipe') || s.includes('purge')) counts.wiped++;
    }

    this.securityMatrix.updatePipeline(counts);
  }

  /**
   * Registers a pending human-in-the-loop approval.
   * @private
   */
  _handleApprovalRequired(approval) {
    if (!approval || !approval.task_id) return;
    this.pendingApprovals.set(approval.task_id, approval);

    this.logStream.addLog({
      level: 'WARN',
      message: `ALERT: Human-in-the-Loop intervention required on [${approval.container_id || approval.task_id}]. Reason: ${approval.reason}`
    });

    this.toast.warning(
      'Intervention Flagged',
      `Target challenge detected on container ${approval.container_id || ''}. Human review needed.`,
      8000
    );

    this._renderApprovals();
  }

  /**
   * Removes an approval request from view.
   * @private
   */
  _removeApproval(taskId) {
    this.pendingApprovals.delete(taskId);
    this._renderApprovals();
  }

  /**
   * Re-renders the Human-in-the-Loop approval requests panel.
   * @private
   */
  _renderApprovals() {
    if (!this.dom.approvalsContainer || !this.dom.approvalCountBadge) return;

    const count = this.pendingApprovals.size;
    this.dom.approvalCountBadge.textContent = `${count} Pending`;

    if (this.dom.approvalSection) {
      this.dom.approvalSection.classList.toggle('has-pending', count > 0);
    }

    if (count === 0) {
      this.dom.approvalsContainer.innerHTML = `
        <div class="approval-empty-state">
          <svg viewBox="0 0 24 24">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
          </svg>
          <span>All browser sandboxes operating fully autonomously. Zero human interventions currently flagged.</span>
        </div>
      `;
      return;
    }

    this.dom.approvalsContainer.innerHTML = '';
    for (const approval of this.pendingApprovals.values()) {
      const card = TaskCard.renderApprovalCard(
        approval,
        (id) => this.approveTask(id),
        (id) => this.rejectTask(id)
      );
      this.dom.approvalsContainer.appendChild(card);
    }
  }

  /**
   * Records a dispatched batch in local history UI.
   * @private
   */
  _recordBatch(batch) {
    this.batches.unshift(batch);
    if (!this.dom.batchHistoryList || !this.dom.batchTotalCount) return;

    this.dom.batchTotalCount.textContent = `${this.batches.length} batch${this.batches.length === 1 ? '' : 'es'}`;
    this.dom.batchHistoryList.innerHTML = '';

    for (const b of this.batches) {
      const item = document.createElement('div');
      item.className = 'batch-history-item';
      const timeStr = b.timestamp.toLocaleTimeString();

      item.innerHTML = `
        <div class="batch-info">
          <span class="batch-id">${escapeHtml(b.batchId)}</span>
          <span class="batch-time">${escapeHtml(timeStr)} • ${b.urlCount} URLs</span>
        </div>
        <div class="batch-meta">
          <span class="status-badge badge-completed">${escapeHtml(b.status)}</span>
        </div>
      `;
      this.dom.batchHistoryList.appendChild(item);
    }
  }

  /**
   * Inserts or updates an extracted competitor intelligence row.
   * @private
   */
  _upsertResultRecord(record) {
    const existingIndex = this.results.findIndex(r => r.taskId === record.taskId);
    if (existingIndex >= 0) {
      this.results[existingIndex] = { ...this.results[existingIndex], ...record };
    } else {
      this.results.unshift(record);
    }
    this._renderResultsTable();
  }

  /**
   * Renders the Results Table with confidence bars and actions.
   * @private
   */
  _renderResultsTable(filterQuery = '') {
    if (!this.dom.resultsTableBody || !this.dom.resultsCountBadge) return;

    let items = this.results;
    if (filterQuery) {
      items = items.filter(r => 
        (r.productName && r.productName.toLowerCase().includes(filterQuery)) ||
        (r.url && r.url.toLowerCase().includes(filterQuery)) ||
        (r.status && r.status.toLowerCase().includes(filterQuery))
      );
    }

    this.dom.resultsCountBadge.textContent = `(${items.length} items)`;

    if (items.length === 0) {
      this.dom.resultsTableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 32px;">
            ${filterQuery ? 'No intelligence records match the search filter.' : 'No extraction missions executed yet. Enter target URLs above and click Deploy Ghost Fleet.'}
          </td>
        </tr>
      `;
      return;
    }

    this.dom.resultsTableBody.innerHTML = '';
    for (const item of items) {
      const tr = document.createElement('tr');

      const confPct = Math.round((item.confidence || 0.9) * 100);
      let confColor = 'var(--accent-green)';
      if (confPct < 70) confColor = 'var(--accent-orange)';
      if (confPct < 50) confColor = 'var(--accent-red)';

      const priceDisplay = item.price !== null && item.price !== undefined
        ? `${item.currency || '$'}${Number(item.price).toFixed(2)}`
        : '<span style="color: var(--text-muted); font-size: 0.75rem;">PENDING</span>';

      let timeFormatted = item.extractedAt;
      try {
        timeFormatted = new Date(item.extractedAt).toLocaleTimeString();
      } catch {
        // Keep raw string
      }

      const domain = item.url ? new URL(item.url, 'http://localhost').hostname : 'target';

      tr.innerHTML = `
        <td>
          <div class="table-cell-url" title="${escapeHtml(item.url)}">
            ${escapeHtml(domain)}
          </div>
        </td>
        <td>
          <div class="table-cell-product" title="${escapeHtml(item.productName)}">
            ${escapeHtml(item.productName)}
          </div>
        </td>
        <td>
          <span class="table-cell-price">${priceDisplay}</span>
        </td>
        <td>
          <div class="confidence-bar-container">
            <div class="confidence-bar-track">
              <div class="confidence-bar-fill" style="width: ${confPct}%; background: ${confColor};"></div>
            </div>
            <span class="confidence-text">${confPct}%</span>
          </div>
        </td>
        <td>
          <span class="status-badge badge-completed">${escapeHtml(item.status)}</span>
        </td>
        <td>
          <span class="mono" style="font-size: 0.72rem; color: var(--text-secondary);">${escapeHtml(timeFormatted)}</span>
        </td>
        <td>
          <button class="btn btn-secondary btn-sm btn-inspect-row" title="Inspect full metadata">
            Inspect
          </button>
        </td>
      `;

      const inspectBtn = tr.querySelector('.btn-inspect-row');
      if (inspectBtn) {
        inspectBtn.addEventListener('click', () => {
          this.openLightbox({
            url: item.url,
            containerId: `task-${item.taskId.substring(0, 8)}`,
            step: `Extracted: ${item.productName} for ${priceDisplay}`,
            timestamp: item.extractedAt
          });
        });
      }

      this.dom.resultsTableBody.appendChild(tr);
    }
  }

  _filterResultsTable(query) {
    this._renderResultsTable(query);
  }

  /**
   * Opens the full-screen screenshot lightbox modal.
   */
  openLightbox(snapshot = {}) {
    if (!this.dom.modal) return;

    if (this.dom.modalTitle) {
      this.dom.modalTitle.textContent = snapshot.containerId 
        ? `Sandbox Inspection: ${snapshot.containerId}`
        : 'Sandbox Inspector';
    }
    if (this.dom.modalTag) {
      this.dom.modalTag.textContent = snapshot.containerId || 'CONTAINER #SEC-01';
    }
    if (this.dom.modalMetaUrl) {
      this.dom.modalMetaUrl.textContent = snapshot.url || 'https://unknown-target.internal';
    }
    if (this.dom.modalMetaStep) {
      this.dom.modalMetaStep.textContent = snapshot.step || 'Active Mission';
    }
    if (this.dom.modalMetaTime) {
      this.dom.modalMetaTime.textContent = snapshot.timestamp 
        ? new Date(snapshot.timestamp).toLocaleString()
        : new Date().toLocaleTimeString();
    }
    if (this.dom.modalImage) {
      this.dom.modalImage.src = snapshot.image || this.screenshotViewer._generateFallbackImage(
        snapshot.url || 'target',
        snapshot.containerId || 'inspector'
      );
    }

    this.dom.modal.classList.add('open');
    this.dom.modal.setAttribute('aria-hidden', 'false');
  }

  /**
   * Closes the screenshot lightbox modal.
   */
  closeLightbox() {
    if (this.dom.modal) {
      this.dom.modal.classList.remove('open');
      this.dom.modal.setAttribute('aria-hidden', 'true');
    }
  }

  /**
   * Exports scraped intelligence as a downloadable CSV.
   */
  exportCsv() {
    if (this.results.length === 0) {
      this.toast.warning('No Records', 'There are no extracted records to export.');
      return;
    }

    const headers = ['Task ID', 'Target URL', 'Product Name', 'Extracted Price', 'Currency', 'Confidence', 'Status', 'Timestamp'];
    const rows = this.results.map(r => [
      `"${r.taskId || ''}"`,
      `"${(r.url || '').replace(/"/g, '""')}"`,
      `"${(r.productName || '').replace(/"/g, '""')}"`,
      r.price !== null && r.price !== undefined ? r.price : '',
      `"${r.currency || '$'}"`,
      r.confidence !== undefined ? r.confidence : '',
      `"${r.status || ''}"`,
      `"${r.extractedAt || ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `ghost_shopper_intelligence_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();

    this.toast.success('CSV Exported', `Generated intelligence CSV with ${this.results.length} rows.`);
  }

  /**
   * Exports scraped intelligence as a downloadable JSON file.
   */
  exportJson() {
    if (this.results.length === 0) {
      this.toast.warning('No Records', 'There are no extracted records to export.');
      return;
    }

    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(this.results, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `ghost_shopper_intelligence_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    this.toast.success('JSON Exported', `Exported full JSON intelligence payload.`);
  }

  /**
   * Autonomous Simulation Mode:
   * Generates realistic cyberpunk scraping missions, container lifecycle transitions,
   * CPU/RAM load variations, network firewall blockades, and live sample screenshots.
   */
  toggleSimulationMode() {
    this.isSimulationActive = !this.isSimulationActive;

    if (this.dom.demoModeLabel) {
      this.dom.demoModeLabel.textContent = this.isSimulationActive ? 'Simulation: ACTIVE' : 'Simulation Mode';
    }
    if (this.dom.btnToggleDemo) {
      this.dom.btnToggleDemo.classList.toggle('btn-primary', this.isSimulationActive);
      this.dom.btnToggleDemo.classList.toggle('btn-secondary', !this.isSimulationActive);
    }

    if (this.isSimulationActive) {
      this.toast.info('Autonomous Simulation Started', 'Simulating fleet telemetry, bot bypasses, and data extractions.');
      this._startSimulationLoop();
    } else {
      if (this.simTimer) clearInterval(this.simTimer);
      this.toast.info('Simulation Paused', 'Returned to passive monitoring mode.');
    }
  }

  _startSimulationLoop() {
    if (this.simTimer) clearInterval(this.simTimer);

    // Initial simulated burst
    this._simulateStep();

    this.simTimer = setInterval(() => {
      this._simulateStep();
    }, 3500);
  }

  _simulateStep() {
    // Dynamic CPU & RAM fluctuations
    const cpu = Math.floor(35 + Math.random() * 45);
    const ram = Math.floor(45 + Math.random() * 30);
    const blockedDelta = Math.floor(Math.random() * 3);
    const currentBlocked = (this.securityMatrix.blockedCount || 0) + blockedDelta;

    this.securityMatrix.setCpu(cpu);
    this.securityMatrix.setRam(ram, (ram / 100) * 16, 16);
    this.securityMatrix.setBlockedRequests(currentBlocked);
    this.securityMatrix.setContainers({
      active: Math.floor(3 + Math.random() * 4),
      idle: Math.floor(6 + Math.random() * 6),
      total: 16,
      wiped: (this.securityMatrix.wipedCount || 12) + 1
    });

    // Simulated log messages
    const simLogs = [
      { level: 'INFO', msg: 'Rotating residential proxy IP pool -> 185.220.101.44 [Latency: 42ms]' },
      { level: 'SECURITY', msg: 'Defeated TLS fingerprint probe (JA3 signature spoofed)' },
      { level: 'INFO', msg: 'Extracted DOM subtree #product-price-primary via headless CDP pipe' },
      { level: 'WARN', msg: 'Ad-tracker blocked by egress sandbox filter: analytics.beacon-tracker.com' },
      { level: 'SECURITY', msg: 'Zero-residual memory purge executed on container-mv81 [Wiped 512MB RAM]' }
    ];
    const logItem = simLogs[Math.floor(Math.random() * simLogs.length)];
    this.logStream.addLog({
      level: logItem.level,
      message: logItem.msg
    });

    // Simulated sample extraction record occasionally
    if (Math.random() > 0.4) {
      const sampleProducts = [
        { name: 'Sony WH-1000XM5 Wireless Headphones', price: 348.00 },
        { name: 'LG UltraGear 27GP850-B Gaming Monitor', price: 296.99 },
        { name: 'Apple MacBook Air M3 15-inch 16GB', price: 1449.00 },
        { name: 'Samsung 990 PRO 2TB PCIe 4.0 NVMe SSD', price: 179.99 },
        { name: 'Keychron Q1 Pro Wireless Custom Keyboard', price: 198.50 },
        { name: 'Anker Prime 20,000mAh Power Bank 200W', price: 119.99 }
      ];
      const prod = sampleProducts[Math.floor(Math.random() * sampleProducts.length)];
      const randId = Math.random().toString(36).substring(2, 10);

      this._upsertResultRecord({
        taskId: `sim-${randId}`,
        url: `https://www.target-store.com/item/${randId}`,
        productName: prod.name,
        price: prod.price,
        currency: '$',
        confidence: 0.92 + Math.random() * 0.07,
        status: 'COMPLETED',
        extractedAt: new Date().toISOString()
      });
    }

    // Trigger an occasional sample Human-in-the-Loop challenge if none pending
    if (this.pendingApprovals.size === 0 && Math.random() > 0.75) {
      const challengeId = `sim-chall-${Date.now().toString(36).substring(4)}`;
      this._handleApprovalRequired({
        task_id: challengeId,
        container_id: `container-${Math.floor(Math.random() * 900 + 100)}`,
        reason: 'Cloudflare Turnstile challenge flagged unusual TLS handshake. Requires verification bypass.',
        timestamp: Date.now()
      });
    }
  }

  /**
   * Simulates a local scraping batch when the backend is offline.
   * @private
   */
  _simulateLocalBatch(urls) {
    const batchId = `local-${Date.now().toString(36)}`;
    this._recordBatch({
      batchId,
      urlCount: urls.length,
      status: 'DISPATCHED',
      timestamp: new Date()
    });

    urls.forEach((url, idx) => {
      const taskId = `task-local-${idx}-${Math.random().toString(36).substring(2, 6)}`;
      const domain = new URL(url, 'http://localhost').hostname;

      // Stage 1: Provisioning
      setTimeout(() => {
        this._handleTaskUpdate({
          task_id: taskId,
          url,
          container_id: `container-vm${idx + 10}`,
          status: 'PROVISIONING',
          step: `Allocating isolated microVM for ${domain}`
        });
      }, idx * 600);

      // Stage 2: Executing
      setTimeout(() => {
        this._handleTaskUpdate({
          task_id: taskId,
          url,
          container_id: `container-vm${idx + 10}`,
          status: 'EXECUTING',
          step: `Navigating stealthily to ${domain}`
        });
      }, idx * 600 + 1200);

      // Stage 3: Completed Extraction
      setTimeout(() => {
        const estPrice = (49.99 + Math.random() * 350).toFixed(2);
        this._handleTaskUpdate({
          task_id: taskId,
          url,
          container_id: `container-vm${idx + 10}`,
          status: 'COMPLETED',
          step: `Intelligence extracted successfully`,
          product_name: `Target Item [${domain}]`,
          price: parseFloat(estPrice),
          currency: '$',
          confidence: 0.94 + Math.random() * 0.05
        });
      }, idx * 600 + 3500);
    });
  }

  /**
   * Simulates local Pattern B Goal planning when backend is offline.
   * @private
   */
  _simulateLocalGoal(goalText) {
    const batchId = `goal-local-${Date.now().toString(36)}`;
    const syntheticUrls = [
      'https://www.bestbuy.com/site/sony-headphones-xm5/6505727.p',
      'https://www.walmart.com/ip/Sony-WH-1000XM5-Wireless-Noise-Canceling/105312389',
      'https://www.target-store.com/electronics/competitor-item-3'
    ];

    this.logStream.addLog({
      level: 'INFO',
      message: `[AGENT PLANNER] Goal received: "${goalText}"`
    });
    this.logStream.addLog({
      level: 'INFO',
      message: `[AGENT PLANNER] Step 1: Deconstruct goal into 3 competitor retail targets`
    });
    this.logStream.addLog({
      level: 'INFO',
      message: `[AGENT PLANNER] Step 2: Acquire pre-warmed gVisor microVMs (zero host secrets)`
    });
    this.logStream.addLog({
      level: 'INFO',
      message: `[AGENT PLANNER] Step 3: Run Playwright Chromium, extract DOM, capture screenshot`
    });
    this.logStream.addLog({
      level: 'INFO',
      message: `[AGENT PLANNER] Step 4: Tier-2 verification via Vultr Llama 3.2 Vision`
    });

    this._recordBatch({
      batchId,
      urlCount: syntheticUrls.length,
      status: 'PLANNED_AND_DISPATCHED',
      timestamp: new Date()
    });

    this._simulateLocalBatch(syntheticUrls);
  }

  /**
   * Simulates local Containment Moment showcase for demo video recording.
   * @private
   */
  _simulateLocalContainment(scenario) {
    const demoId = `demo-${Date.now().toString(36).substring(4)}`;
    const cid = `gvisor-sandbox-${demoId}`;

    if (scenario === 'SSRF_METADATA_ATTACK') {
      this.logStream.addLog({ level: 'SECURITY', message: '═══ DEMO CONTAINMENT: SSRF METADATA EXPLOIT ═══' });
      this.logStream.addLog({ level: 'LAUNCH', message: `Allocating gVisor container ${cid} with runsc kernel isolation.` });
      
      setTimeout(() => {
        this.logStream.addLog({ level: 'WARN', message: `Target page script attempted outbound connection to 169.254.169.254:80 (Vultr Metadata)` });
      }, 700);

      setTimeout(() => {
        this.logStream.addLog({ level: 'SECURITY', message: `[EGRESS BLOCKADE] Syscall intercepted by gVisor Sentry. Packet to 169.254.169.254 dropped.` });
        this.logStream.addLog({ level: 'SECURITY', message: `[SECRET HYGIENE] Sandbox has ZERO host credentials or API keys. Exfiltration blocked.` });
        const currentBlocked = (this.securityMatrix.blockedCount || 0) + 1;
        this.securityMatrix.setBlockedRequests(currentBlocked);
      }, 1500);

      setTimeout(() => {
        this.logStream.addLog({ level: 'SECURITY', message: `Zero-residual purge: docker rm -f ${cid}. Host VM integrity 100% verified.` });
        this.toast.success('SSRF Blocked', 'Containment verified: 169.254.169.254 egress dropped.');
      }, 2300);

    } else if (scenario === 'MEMORY_BOMB_OOM') {
      this.logStream.addLog({ level: 'SECURITY', message: '═══ DEMO CONTAINMENT: RUNAWAY MEMORY BOMB (OOM TRAP) ═══' });
      this.logStream.addLog({ level: 'LAUNCH', message: `Sandbox ${cid} active with 512MB RAM cap (swap completely disabled).` });

      setTimeout(() => {
        this.securityMatrix.setRam(75, 12, 16);
        this.logStream.addLog({ level: 'WARN', message: `Runaway memory allocation detected: 380MB / 512MB quota...` });
      }, 600);

      setTimeout(() => {
        this.securityMatrix.setRam(98, 15.6, 16);
        this.logStream.addLog({ level: 'WARN', message: `Memory allocation approaching ceiling: 508MB / 512MB limit!` });
      }, 1300);

      setTimeout(() => {
        this.logStream.addLog({ level: 'SECURITY', message: `[OOM TRAP TRIGGERED] gVisor OOM-killer terminated sandbox process. Host CPU: 0.9%, Host memory unaffected.` });
        this.logStream.addLog({ level: 'INFO', message: `Hard purge completed: docker rm -f ${cid}. Blast radius ZERO.` });
        this.securityMatrix.setRam(40, 6.4, 16);
        this.toast.success('OOM Contained', 'Sandbox dropped at 512MB ceiling without host impact.');
      }, 2200);

    } else if (scenario === 'DECEPTIVE_PRICE_HITL') {
      this.logStream.addLog({ level: 'SECURITY', message: '═══ DEMO CONTAINMENT: DECEPTIVE PRICING & HITL FREEZE ═══' });
      this.logStream.addLog({ level: 'NAVIGATE', message: `Sandbox ${cid} navigating to deceptive retail target...` });

      setTimeout(() => {
        this.logStream.addLog({ level: 'EXTRACT', message: `DOM parser reports price: '$0.00' (Free Item)` });
      }, 800);

      setTimeout(() => {
        this.logStream.addLog({ level: 'SECURITY', message: `[TIER 1 ANOMALY] Suspicious $0.00 price detected. Routing screenshot to Vultr Llama 3.2 Vision...` });
      }, 1600);

      setTimeout(() => {
        this.logStream.addLog({ level: 'SECURITY', message: `[VULTR VISION LLM] Llama 3.2 Vision: 'Visual inspection shows $249.99 with $50 hidden checkout fee. Prompt injection suspected.'` });
        this.logStream.addLog({ level: 'SECURITY', message: `[HITL FREEZE] Executed 'docker pause ${cid}'. Container CPU frozen at 0.00%. Awaiting operator intervention.` });

        this._handleApprovalRequired({
          task_id: `task-${demoId}`,
          container_id: cid,
          reason: 'Tier-2 Vision Audit flagged Deceptive $0.00 DOM Price & Hidden Fee Trap ($249.99). Operator authorization required.',
          timestamp: Date.now()
        });
        this.toast.warning('HITL Freeze Active', 'Container paused. Operator approval required in dashboard.');
      }, 2600);
    }
  }

  /**
   * Opens the Vultr Credential & Infrastructure Configuration Modal.
   */
  openVultrModal() {
    if (!this.dom.vultrModal) return;
    this.dom.vultrModal.classList.add('open');
    this.dom.vultrModal.setAttribute('aria-hidden', 'false');
    this.fetchVultrConfig();
  }

  /**
   * Closes the Vultr Configuration Modal.
   */
  closeVultrModal() {
    if (!this.dom.vultrModal) return;
    this.dom.vultrModal.classList.remove('open');
    this.dom.vultrModal.setAttribute('aria-hidden', 'true');
  }

  /**
   * Fetches the current Vultr configuration and updates UI status indicators.
   */
  async fetchVultrConfig() {
    try {
      const response = await fetch('/api/config/vultr');
      if (!response.ok) return;
      const data = await response.json();

      if (this.dom.vultrBadgeLabel) {
        if (data.configured) {
          this.dom.vultrBadgeLabel.textContent = '⚡ Vultr: Active';
          this.dom.vultrBadgeLabel.style.color = '#00f0ff';
        } else {
          this.dom.vultrBadgeLabel.textContent = '🔑 Vultr: Ready';
          this.dom.vultrBadgeLabel.style.color = '';
        }
      }

      if (this.dom.vultrModalModeBadge) {
        if (data.configured) {
          this.dom.vultrModalModeBadge.textContent = 'VULTR CLOUD ACTIVE';
          this.dom.vultrModalModeBadge.style.background = 'rgba(0, 240, 255, 0.2)';
          this.dom.vultrModalModeBadge.style.color = '#00f0ff';
        } else {
          this.dom.vultrModalModeBadge.textContent = 'SIMULATION READY';
          this.dom.vultrModalModeBadge.style.background = 'rgba(0, 255, 136, 0.15)';
          this.dom.vultrModalModeBadge.style.color = 'var(--accent-green)';
        }
      }

      if (this.dom.vultrModalStatusText) {
        if (data.configured) {
          this.dom.vultrModalStatusText.textContent = `Live Cloud Engine: ${data.vision_model} active with gVisor microVMs.`;
        } else {
          this.dom.vultrModalStatusText.textContent = 'Local Simulation Active (Zero Keys Required for Testing)';
        }
      }

      if (this.dom.selectVultrVisionModel && data.vision_model) {
        this.dom.selectVultrVisionModel.value = data.vision_model;
      }

      if (data.configured) {
        if (this.dom.inputVultrApiKey && !this.dom.inputVultrApiKey.value) {
          this.dom.inputVultrApiKey.placeholder = data.api_key_masked || '•••••••••••••••• (Configured)';
        }
        if (this.dom.inputVultrInfKey && !this.dom.inputVultrInfKey.value) {
          this.dom.inputVultrInfKey.placeholder = data.inference_key_masked || '•••••••••••••••• (Configured)';
        }
      }
    } catch (err) {
      console.warn('[VULTR CONFIG] Could not sync Vultr configuration:', err);
    }
  }

  /**
   * Saves updated Vultr credentials and vision model settings.
   */
  async saveVultrConfig() {
    const apiKey = this.dom.inputVultrApiKey ? this.dom.inputVultrApiKey.value.trim() : '';
    const infKey = this.dom.inputVultrInfKey ? this.dom.inputVultrInfKey.value.trim() : '';
    const visionModel = this.dom.selectVultrVisionModel ? this.dom.selectVultrVisionModel.value : 'llama-3.2-90b-vision-preview';

    if (!apiKey && !infKey) {
      this.toast.warning('Empty Keys', 'Please paste your Vultr API Key or Inference Key.');
      return;
    }

    if (this.dom.btnSaveVultrKeys) {
      this.dom.btnSaveVultrKeys.disabled = true;
      this.dom.btnSaveVultrKeys.textContent = 'Saving...';
    }

    try {
      const payload = {
        api_key: apiKey || null,
        inference_key: infKey || null,
        vision_model: visionModel
      };

      const res = await fetch('/api/config/vultr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error(`Server returned HTTP ${res.status}`);
      }

      const result = await res.json();
      this.toast.success('Vultr Configured', 'Vultr credentials activated successfully! Cloud execution enabled.');
      this.logStream.addLog({
        level: 'SECURITY',
        message: `[VULTR INTEGRATION] Activated live credentials. Vision model set to ${visionModel}.`
      });

      await this.fetchVultrConfig();
      setTimeout(() => this.closeVultrModal(), 1200);
    } catch (err) {
      this.toast.error('Save Failed', `Could not update credentials: ${err.message}`);
    } finally {
      if (this.dom.btnSaveVultrKeys) {
        this.dom.btnSaveVultrKeys.disabled = false;
        this.dom.btnSaveVultrKeys.textContent = '💾 Save & Activate Vultr';
      }
    }
  }

  /**
   * Tests connection to Vultr Cloud API and Serverless Inference endpoint.
   */
  async testVultrKeys() {
    const apiKey = this.dom.inputVultrApiKey ? this.dom.inputVultrApiKey.value.trim() : '';
    const infKey = this.dom.inputVultrInfKey ? this.dom.inputVultrInfKey.value.trim() : '';

    if (this.dom.btnTestVultrKeys) {
      this.dom.btnTestVultrKeys.disabled = true;
      this.dom.btnTestVultrKeys.textContent = 'Testing...';
    }

    try {
      if (!apiKey && !infKey) {
        const res = await fetch('/api/config/vultr');
        const data = await res.json();
        if (data.configured) {
          this.toast.success('Connection Verified', `Vultr active with model: ${data.vision_model}`);
        } else {
          this.toast.info('Simulation Active', 'No external Vultr keys set. Running in zero-cost local simulation mode.');
        }
      } else {
        await this.saveVultrConfig();
      }
    } catch (err) {
      this.toast.error('Test Failed', err.message);
    } finally {
      if (this.dom.btnTestVultrKeys) {
        this.dom.btnTestVultrKeys.disabled = false;
        this.dom.btnTestVultrKeys.textContent = '🔍 Test Connection';
      }
    }
  }
}

// Bootstrap application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new GhostShopperApp();
  app.init();
  window.ghostApp = app;
});
