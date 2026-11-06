/**
 * ChatTranscript
 * -----------------------------------------------------------------------------
 * Renders the "Easy Mode" price-comparison flow as an agent conversation.
 *
 * Design constraint: every element id that app.js binds to is preserved. This
 * module only *adds* DOM inside #chat-messages and re-anchors the existing
 * singleton result card (#chat-result-slot) to the end of the transcript, so
 * app.js keeps updating the same #comp-* elements it always has.
 *
 * It also wraps LogStream#addLog so that log lines emitted while a search is in
 * flight are mirrored into the conversation as the agent's "working" trail.
 */

const LEVEL_CLASS = {
  ERROR: 'wk-error',
  WARN: 'wk-warn',
  WARNING: 'wk-warn',
  SECURITY: 'wk-warn',
};

export class ChatTranscript {
  /**
   * @param {import('./app.js').GhostShopperApp} app
   */
  constructor(app) {
    this.app = app;

    this.transcriptEl = document.getElementById('chat-transcript');
    this.messagesEl = document.getElementById('chat-messages');
    this.welcomeEl = document.getElementById('chat-welcome');
    this.resultSlot = document.getElementById('chat-result-slot');

    /** @type {HTMLElement|null} the <ul> collecting work lines for the live search */
    this._activeWorkList = null;
    /** @type {HTMLElement|null} */
    this._typingEl = null;
    this._workLineCount = 0;

    this._bindStarters();
    this._hookLogStream();
  }

  /* ---------------------------------------------------------------- wiring */

  /**
   * The welcome-screen starter cards are not wired by app.js (it only binds
   * `.quick-chip-btn[data-query]`), so drive them through the existing path:
   * populate the composer and click send. No duplicated search logic.
   */
  _bindStarters() {
    document.querySelectorAll('.chat-starter[data-query]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const q = btn.getAttribute('data-query');
        const input = document.getElementById('hero-product-search');
        const send = document.getElementById('btn-hero-search');
        if (input) input.value = q;
        if (send) send.click();
      });
    });
  }

  /**
   * Mirror log entries into the active work list while a search is running.
   * Wraps rather than replaces, so the Security-view terminal is unaffected.
   */
  _hookLogStream() {
    const logStream = this.app && this.app.logStream;
    if (!logStream || typeof logStream.addLog !== 'function') return;

    const original = logStream.addLog.bind(logStream);
    logStream.addLog = (entry) => {
      original(entry);
      this._onLog(entry);
    };
  }

  _onLog(entry) {
    if (!this._activeWorkList) return;

    const item = typeof entry === 'string' ? { message: entry, level: 'INFO' } : entry || {};
    const message = (item.message || '').toString().trim();
    if (!message) return;

    this.addWorkLine(message, (item.level || 'INFO').toUpperCase());
  }

  /* ------------------------------------------------------------- rendering */

  _scrollToBottom() {
    if (!this.transcriptEl) return;
    // Only follow the tail if the user hasn't scrolled up to read.
    const distanceFromBottom =
      this.transcriptEl.scrollHeight - this.transcriptEl.scrollTop - this.transcriptEl.clientHeight;
    if (distanceFromBottom < 140) {
      this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
    }
  }

  _hideWelcome() {
    if (this.welcomeEl) this.welcomeEl.style.display = 'none';
  }

  /**
   * Append a chat message.
   * @param {'user'|'agent'} role
   * @param {string} text
   * @param {{label?: string}} [opts]
   * @returns {HTMLElement}
   */
  addMessage(role, text, opts = {}) {
    if (!this.messagesEl) return null;
    this._hideWelcome();

    const row = document.createElement('div');
    row.className = `msg msg-${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = role === 'user' ? 'YOU' : '\uD83D\uDD2E';

    const body = document.createElement('div');
    body.className = 'msg-body';

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = opts.label || (role === 'user' ? 'You' : 'Ghost Shopper');

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = text;

    body.append(meta, bubble);
    row.append(avatar, body);
    this.messagesEl.appendChild(row);
    this._scrollToBottom();
    return row;
  }

  /**
   * Open a new "working" block: user message + agent work list + typing dots.
   * @param {string} query
   * @param {string[]} stores
   */
  beginWork(query, stores = []) {
    if (!this.messagesEl) return;
    this._hideWelcome();

    this.addMessage('user', query);

    const row = document.createElement('div');
    row.className = 'msg msg-agent msg-work';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = '\uD83D\uDD2E';

    const body = document.createElement('div');
    body.className = 'msg-body';

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    meta.textContent = 'Ghost Shopper';

    const intro = document.createElement('div');
    intro.className = 'msg-bubble';
    const storeText = stores && stores.length ? stores.join(', ') : 'your selected stores';
    intro.textContent = `Searching ${storeText} for "${query}".`;

    const list = document.createElement('ul');
    list.className = 'msg-worklist';
    list.setAttribute('role', 'log');

    body.append(meta, intro, list);
    row.append(avatar, body);
    this.messagesEl.appendChild(row);

    this._activeWorkList = list;
    this._workLineCount = 0;

    this._showTyping();
    this._scrollToBottom();
  }

  /**
   * Append one line to the active work list.
   * @param {string} text
   * @param {string} [level]
   */
  addWorkLine(text, level = 'INFO') {
    if (!this._activeWorkList) return;

    const li = document.createElement('li');
    const cls = LEVEL_CLASS[level];
    if (cls) li.className = cls;

    const dot = document.createElement('span');
    dot.className = 'wk-dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.textContent = '\u25B8';

    const span = document.createElement('span');
    span.textContent = text;

    li.append(dot, span);
    this._activeWorkList.appendChild(li);
    this._workLineCount += 1;

    // Keep the trail readable; older lines are still in the Security terminal.
    while (this._activeWorkList.children.length > 14) {
      this._activeWorkList.removeChild(this._activeWorkList.firstElementChild);
    }

    this._scrollToBottom();
  }

  _showTyping() {
    if (!this.messagesEl || this._typingEl) return;

    const row = document.createElement('div');
    row.className = 'msg msg-agent msg-typing';
    row.setAttribute('aria-hidden', 'true');

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = '\uD83D\uDD2E';

    const body = document.createElement('div');
    body.className = 'msg-body';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    for (let i = 0; i < 3; i += 1) {
      const d = document.createElement('span');
      d.className = 'typing-dot';
      bubble.appendChild(d);
    }

    body.appendChild(bubble);
    row.append(avatar, body);
    this.messagesEl.appendChild(row);

    this._typingEl = row;
    this._scrollToBottom();
  }

  _hideTyping() {
    if (this._typingEl && this._typingEl.parentNode) {
      this._typingEl.parentNode.removeChild(this._typingEl);
    }
    this._typingEl = null;
  }

  /**
   * Close out the working block and reveal the refreshed result card as the
   * latest reply in the conversation.
   * @param {string} [summary]
   */
  endWork(summary) {
    this._hideTyping();
    this._activeWorkList = null;

    if (summary) {
      this.addMessage('agent', summary);
    }

    if (this.resultSlot) {
      this.resultSlot.hidden = false;
      // Re-anchor to the end so it always reads as the newest reply.
      if (this.messagesEl && this.messagesEl.parentNode) {
        this.messagesEl.parentNode.insertBefore(
          this.resultSlot,
          this.messagesEl.nextSibling
        );
      }
    }

    this._scrollToBottom();
  }

  /**
   * Close out the working block with an error instead of a result.
   * @param {string} message
   */
  fail(message) {
    this._hideTyping();
    this._activeWorkList = null;
    this.addMessage('agent', message || 'That search did not complete.');
  }
}
