/**
 * @file components.js
 * @description UI Component modules for Ghost Shopper Dashboard.
 * Includes SecurityMatrix, LogStream, ScreenshotViewer, TaskCard, and ToastManager.
 */

// Helper utility to safely escape HTML strings and prevent XSS injection
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

/**
 * SecurityMatrix Component
 * Controls the Security & Infrastructure Observability Matrix, gauges,
 * container allocations, and microVM lifecycle pipeline visualizer.
 */
export class SecurityMatrix {
  /**
   * @param {Object} elements DOM element references
   */
  constructor(elements = {}) {
    this.gaugeCpu = elements.gaugeCpu || document.getElementById('gauge-cpu');
    this.gaugeRam = elements.gaugeRam || document.getElementById('gauge-ram');
    this.metricCpuText = elements.metricCpuText || document.getElementById('metric-cpu-text');
    this.metricRamText = elements.metricRamText || document.getElementById('metric-ram-text');
    this.meterCpuBar = elements.meterCpuBar || document.getElementById('meter-cpu-bar');
    this.meterRamBar = elements.meterRamBar || document.getElementById('meter-ram-bar');
    this.metricBlockedRequests = elements.metricBlockedRequests || document.getElementById('metric-blocked-requests');
    this.meterNetworkBar = elements.meterNetworkBar || document.getElementById('meter-network-bar');
    this.metricContainersActive = elements.metricContainersActive || document.getElementById('metric-containers-active');
    this.metricContainersPool = elements.metricContainersPool || document.getElementById('metric-containers-pool');
    this.meterContainersBar = elements.meterContainersBar || document.getElementById('meter-containers-bar');
    this.headerPurgedCount = elements.headerPurgedCount || document.getElementById('header-purged-count');
    this.headerPoolStatus = elements.headerPoolStatus || document.getElementById('header-pool-status');
    this.headerActiveTasks = elements.headerActiveTasks || document.getElementById('header-active-tasks');

    // Pipeline Stage Nodes and Counters
    this.pipelineStages = ['pooled', 'provisioning', 'executing', 'verifying', 'completed', 'wiped'];
    this.pipelineNodes = {};
    this.pipelineCounts = {};
    for (const stage of this.pipelineStages) {
      this.pipelineNodes[stage] = document.getElementById(`pipe-node-${stage}`);
      this.pipelineCounts[stage] = document.getElementById(`pipe-count-${stage}`);
    }

    this.blockedCount = 0;
    this.wipedCount = 0;
  }

  /**
   * Updates CPU gauge and progress bar.
   * @param {number} percent 0-100
   */
  setCpu(percent) {
    const val = Math.max(0, Math.min(100, Math.round(percent)));
    if (this.metricCpuText) {
      this.metricCpuText.textContent = `${val}%`;
    }
    if (this.meterCpuBar) {
      this.meterCpuBar.style.width = `${val}%`;
      this.meterCpuBar.className = `meter-bar-fill ${val > 80 ? 'red' : val > 60 ? 'orange' : ''}`;
    }
    if (this.gaugeCpu) {
      // Circumference = 100 for SVG dasharray calculations
      const offset = 100 - val;
      this.gaugeCpu.style.strokeDashoffset = offset;
      this.gaugeCpu.className = `gauge-fill ${val > 80 ? 'red' : val > 60 ? 'orange' : 'cyan'}`;
    }
  }

  /**
   * Updates RAM gauge and progress bar.
   * @param {number} percent 0-100
   * @param {number} [usedGb] Optional gigabytes used
   * @param {number} [totalGb] Optional total gigabytes
   */
  setRam(percent, usedGb = null, totalGb = 16) {
    const val = Math.max(0, Math.min(100, Math.round(percent)));
    if (this.metricRamText) {
      this.metricRamText.textContent = `${val}%`;
      const subText = this.metricRamText.nextElementSibling;
      if (subText && usedGb !== null) {
        subText.textContent = `${usedGb.toFixed(1)} / ${totalGb.toFixed(1)} GB`;
      }
    }
    if (this.meterRamBar) {
      this.meterRamBar.style.width = `${val}%`;
      this.meterRamBar.className = `meter-bar-fill ${val > 85 ? 'red' : val > 70 ? 'orange' : ''}`;
    }
    if (this.gaugeRam) {
      const offset = 100 - val;
      this.gaugeRam.style.strokeDashoffset = offset;
      this.gaugeRam.className = `gauge-fill ${val > 85 ? 'red' : val > 70 ? 'orange' : 'green'}`;
    }
  }

  /**
   * Increments or sets the egress network blocked requests tally.
   * @param {number} count Total count or delta
   */
  setBlockedRequests(count) {
    this.blockedCount = Math.max(0, count);
    if (this.metricBlockedRequests) {
      this.metricBlockedRequests.textContent = this.blockedCount.toLocaleString();
    }
    if (this.meterNetworkBar) {
      const fillPercent = Math.min(100, Math.max(5, this.blockedCount * 4));
      this.meterNetworkBar.style.width = `${fillPercent}%`;
    }
  }

  /**
   * Updates container pool and active numbers.
   * @param {Object} stats
   * @param {number} stats.active Number of running sandboxes
   * @param {number} stats.idle Warm available sandboxes in pool
   * @param {number} stats.total Total sandbox capacity
   * @param {number} [stats.wiped] Cumulative purged containers
   */
  setContainers(stats = {}) {
    const active = stats.active || 0;
    const idle = stats.idle || 0;
    const total = stats.total || (active + idle) || 16;
    if (stats.wiped !== undefined) {
      this.wipedCount = stats.wiped;
    }

    if (this.metricContainersActive) {
      this.metricContainersActive.textContent = `${active} ACTIVE`;
    }
    if (this.metricContainersPool) {
      this.metricContainersPool.textContent = `${idle} Warm in Pool (Cap: ${total})`;
    }
    if (this.meterContainersBar) {
      const pct = Math.min(100, Math.round((active / (total || 1)) * 100));
      this.meterContainersBar.style.width = `${pct}%`;
    }
    if (this.headerPoolStatus) {
      this.headerPoolStatus.textContent = `${idle} / ${total} READY`;
    }
    if (this.headerActiveTasks) {
      this.headerActiveTasks.textContent = `${active} RUNNING`;
    }
    if (this.headerPurgedCount && stats.wiped !== undefined) {
      this.headerPurgedCount.textContent = `${this.wipedCount} WIPED`;
    }
  }

  /**
   * Updates the lifecycle pipeline counts and highlighted nodes.
   * @param {Object} pipelineCounts Map of stage name -> count (e.g. { pooled: 5, executing: 2 })
   */
  updatePipeline(pipelineCounts = {}) {
    for (const stage of this.pipelineStages) {
      const count = pipelineCounts[stage] || 0;
      const node = this.pipelineNodes[stage];
      const countEl = this.pipelineCounts[stage];

      if (countEl) {
        countEl.textContent = count;
      }

      if (node) {
        node.classList.remove('active', 'completed', 'warning');
        if (count > 0) {
          if (stage === 'executing' || stage === 'provisioning') {
            node.classList.add('active');
          } else if (stage === 'completed' || stage === 'wiped') {
            node.classList.add('completed');
          } else {
            node.classList.add('warning');
          }
        }
      }
    }
  }

  /**
   * Ingests full telemetry payload from WebSocket or REST poll.
   * @param {Object} data 
   */
  updateTelemetry(data = {}) {
    if (data.cpu_percent !== undefined) this.setCpu(data.cpu_percent);
    if (data.memory_percent !== undefined) {
      const used = data.memory_used_gb || null;
      const total = data.memory_total_gb || 16;
      this.setRam(data.memory_percent, used, total);
    }
    if (data.blocked_requests !== undefined) {
      this.setBlockedRequests(data.blocked_requests);
    }
    if (data.containers || data.total !== undefined) {
      this.setContainers(data.containers || {
        active: data.busy || data.active || 0,
        idle: data.idle || 0,
        total: data.total || 16,
        wiped: data.purged || data.wiped || 0
      });
    }
    if (data.pipeline) {
      this.updatePipeline(data.pipeline);
    }
  }
}

/**
 * LogStream Component
 * Manages the high-speed cyber terminal log panel with ring buffer,
 * pause on hover/manual lock, and severity level filtering.
 */
export class LogStream {
  /**
   * @param {HTMLElement} container Terminal viewport DOM element
   * @param {Object} [options]
   */
  constructor(container, options = {}) {
    this.container = container;
    this.counterEl = options.counterEl || document.getElementById('log-count-badge');
    this.scrollBtn = options.scrollBtn || document.getElementById('btn-toggle-scroll');
    this.maxEntries = options.maxEntries || 500;
    this.activeFilter = 'ALL';
    this.autoScroll = true;
    this.isHovered = false;
    this.entries = []; // Array of log entry objects

    this._bindEvents();
  }

  _bindEvents() {
    if (!this.container) return;

    // Pause autoscroll while user is inspecting/hovering over terminal
    this.container.addEventListener('mouseenter', () => {
      this.isHovered = true;
    });

    this.container.addEventListener('mouseleave', () => {
      this.isHovered = false;
      if (this.autoScroll) {
        this.scrollToBottom();
      }
    });

    if (this.scrollBtn) {
      this.scrollBtn.addEventListener('click', () => {
        this.autoScroll = !this.autoScroll;
        this.scrollBtn.textContent = `Scroll: ${this.autoScroll ? 'ON' : 'OFF'}`;
        this.scrollBtn.classList.toggle('active', this.autoScroll);
        if (this.autoScroll) {
          this.scrollToBottom();
        }
      });
    }
  }

  /**
   * Sets current log filter level ('ALL', 'INFO', 'WARN', 'ERROR').
   * @param {string} filter 
   */
  setFilter(filter) {
    this.activeFilter = filter.toUpperCase();
    this.render();
  }

  /**
   * Adds a new structured log entry.
   * @param {Object|string} entry
   */
  addLog(entry) {
    const item = typeof entry === 'string' 
      ? { message: entry, level: 'INFO', timestamp: new Date().toISOString() }
      : {
          timestamp: entry.timestamp || new Date().toISOString(),
          level: (entry.level || 'INFO').toUpperCase(),
          message: entry.message || '',
          source: entry.source || entry.task_id || 'system'
        };

    // Maintain FIFO buffer
    if (this.entries.length >= this.maxEntries) {
      this.entries.shift();
    }
    this.entries.push(item);

    // Update log counter badge
    if (this.counterEl) {
      this.counterEl.textContent = `(${this.entries.length} events)`;
    }

    // Append to DOM if matches current filter
    if (this._matchesFilter(item.level)) {
      const entryEl = this._createEntryElement(item);
      this.container.appendChild(entryEl);

      // Clean up overflow elements in DOM
      while (this.container.children.length > this.maxEntries) {
        this.container.removeChild(this.container.firstElementChild);
      }

      if (this.autoScroll && !this.isHovered) {
        this.scrollToBottom();
      }
    }
  }

  _matchesFilter(level) {
    if (this.activeFilter === 'ALL') return true;
    if (this.activeFilter === 'ERROR' && level === 'ERROR') return true;
    if (this.activeFilter === 'WARN' && (level === 'WARN' || level === 'WARNING')) return true;
    if (this.activeFilter === 'INFO' && level === 'INFO') return true;
    if (this.activeFilter === 'SECURITY' && level === 'SECURITY') return true;
    return false;
  }

  _createEntryElement(item) {
    const el = document.createElement('div');
    el.className = 'log-entry';

    // Format ISO timestamp to HH:mm:ss.SSS
    let timeStr = item.timestamp;
    try {
      const d = new Date(item.timestamp);
      timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
    } catch {
      timeStr = String(item.timestamp).substring(11, 23);
    }

    let levelClass = 'level-info';
    if (item.level === 'WARN' || item.level === 'WARNING') levelClass = 'level-warn';
    else if (item.level === 'ERROR' || item.level === 'FATAL') levelClass = 'level-error';
    else if (item.level === 'SECURITY') levelClass = 'level-security';

    // Highlight URLs and identifiers in message
    let formattedMsg = escapeHtml(item.message);
    formattedMsg = formattedMsg.replace(/(https?:\/\/[^\s]+)/g, '<span class="url">$1</span>');
    formattedMsg = formattedMsg.replace(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi, '<span class="highlight">$1</span>');
    formattedMsg = formattedMsg.replace(/\b(container-[a-z0-9]+)\b/gi, '<span class="highlight">$1</span>');

    el.innerHTML = `
      <span class="log-timestamp">[${timeStr}]</span>
      <span class="log-level ${levelClass}">${escapeHtml(item.level)}</span>
      <span class="log-message">${formattedMsg}</span>
    `;
    return el;
  }

  /**
   * Re-renders currently buffered entries matching active filter.
   */
  render() {
    if (!this.container) return;
    this.container.innerHTML = '';
    const filtered = this.entries.filter(e => this._matchesFilter(e.level));
    for (const item of filtered) {
      this.container.appendChild(this._createEntryElement(item));
    }
    if (this.autoScroll) {
      this.scrollToBottom();
    }
  }

  scrollToBottom() {
    if (this.container) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }

  clear() {
    this.entries = [];
    if (this.container) {
      this.container.innerHTML = '';
    }
    if (this.counterEl) {
      this.counterEl.textContent = '(0 events)';
    }
  }
}

/**
 * ScreenshotViewer Component
 * Manages the grid of live browser sandbox screen captures,
 * status badges, and integration with the zoom lightbox.
 */
export class ScreenshotViewer {
  /**
   * @param {HTMLElement} gridContainer 
   * @param {Function} onSelect Callback when a snapshot card is clicked
   */
  constructor(gridContainer, onSelect) {
    this.container = gridContainer;
    this.onSelect = onSelect || (() => {});
    this.snapshots = new Map(); // taskId -> snapshot data
    this.activeCountEl = document.getElementById('viewport-active-count');
  }

  /**
   * Updates or inserts a sandbox screen snapshot.
   * @param {string} taskId Unique task identifier
   * @param {Object} data Snapshot metadata
   * @param {string} data.url Target domain or full URL
   * @param {string} data.containerId Isolated container ID
   * @param {string} data.image Base64 encoded or URL image
   * @param {string} data.status Current execution status
   * @param {string} data.step Current browser action step
   */
  updateSnapshot(taskId, data) {
    if (!taskId) return;
    const existing = this.snapshots.get(taskId) || {};
    const updated = { ...existing, ...data, taskId, lastUpdated: Date.now() };
    this.snapshots.set(taskId, updated);

    // Limit active snapshot cards in viewport to at most 6 to prevent layout clutter
    if (this.snapshots.size > 6) {
      for (const [id, snap] of this.snapshots) {
        if (!['EXECUTING', 'PROVISIONING', 'VERIFYING'].includes(snap.status)) {
          this.removeSnapshot(id);
          break;
        }
      }
    }

    this.renderCard(taskId, updated);
    this._updateActiveCount();
  }

  /**
   * Removes a completed or purged snapshot card.
   * @param {string} taskId 
   */
  removeSnapshot(taskId) {
    this.snapshots.delete(taskId);
    const el = document.getElementById(`snapshot-card-${taskId}`);
    if (el) {
      el.remove();
    }
    this._checkEmptyState();
    this._updateActiveCount();
  }

  _updateActiveCount() {
    if (this.activeCountEl) {
      this.activeCountEl.textContent = `${this.snapshots.size} Active Cameras`;
    }
  }

  _checkEmptyState() {
    if (this.snapshots.size === 0 && this.container) {
      this.container.innerHTML = `
        <div class="viewport-empty-state">
          <svg viewBox="0 0 24 24" fill="none">
            <rect x="2" y="3" width="20" height="14" rx="2" stroke-width="2"/>
            <line x1="8" y1="21" x2="16" y2="21" stroke-width="2"/>
            <line x1="12" y1="17" x2="12" y2="21" stroke-width="2"/>
          </svg>
          <p>Awaiting sandbox agent deployment. Submitted missions will display live screen telemetry here.</p>
        </div>
      `;
    }
  }

  /**
   * Creates or updates a specific snapshot DOM element.
   */
  renderCard(taskId, data) {
    if (!this.container) return;

    // Clear empty state message if first snapshot
    const emptyState = this.container.querySelector('.viewport-empty-state');
    if (emptyState) {
      this.container.innerHTML = '';
    }

    let card = document.getElementById(`snapshot-card-${taskId}`);
    if (!card) {
      card = document.createElement('div');
      card.id = `snapshot-card-${taskId}`;
      card.className = 'snapshot-card';
      this.container.appendChild(card);

      card.addEventListener('click', () => {
        this.onSelect(this.snapshots.get(taskId));
      });
    }

    const containerId = escapeHtml(data.containerId || `box-${taskId.substring(0, 6)}`);
    const domain = escapeHtml(data.url ? new URL(data.url, 'http://localhost').hostname : 'target-site');
    const step = escapeHtml(data.step || 'Executing stealth navigation');
    const status = escapeHtml((data.status || 'EXECUTING').toUpperCase());
    const imgSrc = data.image || this._generateFallbackImage(domain, containerId);

    let badgeClass = 'badge-executing';
    if (status.includes('PROVISION')) badgeClass = 'badge-provisioning';
    else if (status.includes('VERIFY')) badgeClass = 'badge-verifying';
    else if (status.includes('COMPLETE')) badgeClass = 'badge-completed';
    else if (status.includes('FAIL')) badgeClass = 'badge-failed';
    else if (status.includes('PAUSE') || status.includes('APPROVAL')) badgeClass = 'badge-paused';

    card.innerHTML = `
      <div class="snapshot-thumb-container">
        <img class="snapshot-thumb-img" src="${imgSrc}" alt="${domain} Capture" loading="lazy">
        <div class="snapshot-scanning-bar"></div>
        <div class="snapshot-overlay-badge">
          <span style="color: var(--accent-cyan); font-weight: 700;">●</span>
          <span>${containerId}</span>
        </div>
        <span class="status-badge ${badgeClass} snapshot-status-pill">${status}</span>
      </div>
      <div class="snapshot-details">
        <div class="snapshot-url" title="${escapeHtml(data.url || '')}">
          ${domain}
        </div>
        <div class="snapshot-step-description">
          <span>${step}</span>
          <span class="mono" style="font-size: 0.65rem; color: var(--text-muted);">LIVE</span>
        </div>
      </div>
    `;
  }

  /**
   * Generates a sleek cyberpunk placeholder SVG data URI when a live screenshot
   * frame is pending transmission.
   * @private
   */
  _generateFallbackImage(domain, containerId) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
        <rect width="100%" height="100%" fill="#070b12"/>
        <line x1="0" y1="90" x2="320" y2="90" stroke="#1e293b" stroke-width="1" stroke-dasharray="4,4"/>
        <line x1="160" y1="0" x2="160" y2="180" stroke="#1e293b" stroke-width="1" stroke-dasharray="4,4"/>
        <circle cx="160" cy="90" r="36" fill="none" stroke="#00f0ff" stroke-width="1.5" stroke-opacity="0.3"/>
        <circle cx="160" cy="90" r="18" fill="none" stroke="#00f0ff" stroke-width="1" stroke-opacity="0.6"/>
        <text x="160" y="86" fill="#00f0ff" font-family="monospace" font-size="12" text-anchor="middle" font-weight="bold">[GHOST AGENT: ACTIVE]</text>
        <text x="160" y="104" fill="#94a3b8" font-family="monospace" font-size="10" text-anchor="middle">${domain}</text>
        <text x="160" y="122" fill="#64748b" font-family="monospace" font-size="9" text-anchor="middle">${containerId}</text>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  clear() {
    this.snapshots.clear();
    this._checkEmptyState();
    this._updateActiveCount();
  }
}

/**
 * TaskCard Component
 * Utility for rendering task items or Human-in-the-Loop approval requests.
 */
export class TaskCard {
  /**
   * Renders a Human-in-the-Loop approval challenge card.
   * @param {Object} approval
   * @param {string} approval.taskId
   * @param {string} approval.containerId
   * @param {string} approval.reason
   * @param {string} [approval.screenshot]
   * @param {Function} onApprove
   * @param {Function} onReject
   * @returns {HTMLElement}
   */
  static renderApprovalCard(approval, onApprove, onReject) {
    const card = document.createElement('div');
    card.className = 'approval-item-card';
    card.id = `approval-card-${approval.taskId}`;

    const containerId = escapeHtml(approval.containerId || 'container-sec0');
    const reason = escapeHtml(approval.reason || 'Bot detection trigger / Security challenge require human authorization.');
    const taskId = escapeHtml(approval.taskId);
    const screenshot = approval.screenshot || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="100%" height="100%" fill="%230f172a"/><text x="50%" y="50%" fill="%23ff6b35" font-size="11" text-anchor="middle" font-family="monospace">CHALLENGE DETECTED</text></svg>';

    card.innerHTML = `
      <div class="approval-header">
        <div class="approval-title-group">
          <span class="approval-badge-warning">Human Action Required</span>
          <span class="mono" style="color: var(--accent-cyan); font-size: 0.8rem; font-weight: 700;">${containerId}</span>
        </div>
        <span class="mono" style="font-size: 0.7rem; color: var(--text-muted);">Task ID: ${taskId.substring(0, 8)}</span>
      </div>
      <div class="approval-content-grid">
        <img class="approval-preview-thumb" src="${screenshot}" alt="Defense Challenge" title="Click to view full preview">
        <div class="approval-meta-text">
          <div class="approval-reason">${reason}</div>
          <div class="approval-subtext">Agent paused execution awaiting resolution override or bypass authorization.</div>
        </div>
      </div>
      <div class="approval-actions">
        <button class="btn btn-danger btn-sm btn-reject" type="button">
          Abort / Reject Task
        </button>
        <button class="btn btn-success btn-sm btn-approve" type="button">
          Authorize / Resume Task
        </button>
      </div>
    `;

    // Bind approval actions
    const approveBtn = card.querySelector('.btn-approve');
    const rejectBtn = card.querySelector('.btn-reject');
    const thumbImg = card.querySelector('.approval-preview-thumb');

    if (approveBtn) {
      approveBtn.addEventListener('click', () => onApprove(approval.taskId));
    }
    if (rejectBtn) {
      rejectBtn.addEventListener('click', () => onReject(approval.taskId));
    }
    if (thumbImg && approval.screenshot) {
      thumbImg.addEventListener('click', () => {
        const modal = document.getElementById('screenshot-modal');
        const modalImg = document.getElementById('modal-image');
        const modalTitle = document.getElementById('modal-title');
        if (modal && modalImg) {
          modalImg.src = approval.screenshot;
          if (modalTitle) modalTitle.textContent = `Challenge Audit: ${containerId}`;
          modal.classList.add('open');
        }
      });
    }

    return card;
  }
}

/**
 * ToastManager Component
 * Manages floating cybernetic toast notifications with auto-dismiss timers,
 * progress bars, and severity styles.
 */
export class ToastManager {
  /**
   * @param {HTMLElement} [container] 
   */
  constructor(container) {
    this.container = container || document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      document.body.appendChild(this.container);
    }
  }

  /**
   * Displays a toast notification.
   * @param {string} title 
   * @param {string} message 
   * @param {'info'|'success'|'warning'|'error'} [type='info'] 
   * @param {number} [duration=5000] Milliseconds before auto-dismiss
   */
  show(title, message, type = 'info', duration = 5000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    toast.innerHTML = `
      <div class="toast-header">
        <span class="toast-title">${escapeHtml(title)}</span>
        <button class="toast-close" aria-label="Dismiss">&times;</button>
      </div>
      <div class="toast-body">${escapeHtml(message)}</div>
      <div class="toast-progress"></div>
    `;

    this.container.appendChild(toast);

    // Progress bar animation
    const progress = toast.querySelector('.toast-progress');
    if (progress) {
      progress.style.transition = `width ${duration}ms linear`;
      // Trigger reflow to start transition
      requestAnimationFrame(() => {
        progress.style.width = '0%';
      });
    }

    const dismiss = () => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 250ms ease';
      setTimeout(() => {
        toast.remove();
      }, 260);
    };

    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', dismiss);
    }

    const timer = setTimeout(dismiss, duration);
    toast.addEventListener('mouseenter', () => clearTimeout(timer));

    return toast;
  }

  success(title, msg, duration) {
    return this.show(title, msg, 'success', duration);
  }

  error(title, msg, duration) {
    return this.show(title, msg, 'error', duration);
  }

  warning(title, msg, duration) {
    return this.show(title, msg, 'warning', duration);
  }

  info(title, msg, duration) {
    return this.show(title, msg, 'info', duration);
  }
}

// Global attachment
if (typeof window !== 'undefined') {
  window.SecurityMatrix = SecurityMatrix;
  window.LogStream = LogStream;
  window.ScreenshotViewer = ScreenshotViewer;
  window.TaskCard = TaskCard;
  window.ToastManager = ToastManager;
}
