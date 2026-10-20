/**
 * @file websocket.js
 * @description Resilient WebSocket client for Ghost Shopper Competitor Intelligence System.
 * Implements exponential backoff reconnection, heartbeat keep-alive, message queueing,
 * and typed event routing.
 */

export class GhostWebSocket {
  /**
   * Initializes the WebSocket client.
   * @param {Object} options Configuration options
   * @param {string} [options.url] WebSocket URL (defaults to current host /ws)
   * @param {number} [options.heartbeatInterval=30000] Ping interval in milliseconds
   * @param {number} [options.initialReconnectDelay=1000] Starting backoff delay in ms
   * @param {number} [options.maxReconnectDelay=30000] Max backoff delay in ms
   * @param {number} [options.maxQueueSize=100] Max offline outgoing message queue size
   */
  constructor(options = {}) {
    // Derive automatic WebSocket URL based on browser origin if not explicitly provided
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const defaultHost = window.location.host || 'localhost:8000';
    this.url = options.url || `${protocol}//${defaultHost}/ws`;

    this.heartbeatInterval = options.heartbeatInterval || 30000;
    this.initialReconnectDelay = options.initialReconnectDelay || 1000;
    this.maxReconnectDelay = options.maxReconnectDelay || 30000;
    this.maxQueueSize = options.maxQueueSize || 100;

    // Internal State
    this.ws = null;
    this.state = 'CLOSED'; // 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'RECONNECTING'
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    this.messageQueue = [];
    this.eventListeners = new Map();
    this.isManualClosure = false;
  }

  /**
   * Subscribes a listener function to a named event or message type.
   * @param {string} event Event name ('open', 'close', 'error', 'status_change', or server message type)
   * @param {Function} handler Callback function
   */
  on(event, handler) {
    if (typeof handler !== 'function') {
      throw new TypeError(`Handler for event "${event}" must be a function.`);
    }
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event).add(handler);
    return this;
  }

  /**
   * Unsubscribes a listener function from an event.
   * @param {string} event Event name
   * @param {Function} handler Callback function to remove
   */
  off(event, handler) {
    if (this.eventListeners.has(event)) {
      this.eventListeners.get(event).delete(handler);
      if (this.eventListeners.get(event).size === 0) {
        this.eventListeners.delete(event);
      }
    }
    return this;
  }

  /**
   * Emits an internal or received message event to registered listeners.
   * @param {string} event Event name
   * @param {*} data Payload delivered to handlers
   */
  emit(event, data) {
    if (this.eventListeners.has(event)) {
      for (const handler of this.eventListeners.get(event)) {
        try {
          handler(data);
        } catch (err) {
          console.error(`[GhostWebSocket] Error in listener for event "${event}":`, err);
        }
      }
    }
  }

  /**
   * Updates and emits connection state changes.
   * @param {string} newState New state string
   */
  _setState(newState) {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      this.emit('status_change', { current: newState, previous: oldState });
    }
  }

  /**
   * Initiates connection to the WebSocket server.
   */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.isManualClosure = false;
    this._setState(this.reconnectAttempts > 0 ? 'RECONNECTING' : 'CONNECTING');

    try {
      this.ws = new WebSocket(this.url);
      this._bindSocketEvents();
    } catch (err) {
      console.warn(`[GhostWebSocket] Immediate connection failed to ${this.url}:`, err);
      this._handleConnectionFailure();
    }
  }

  /**
   * Binds native WebSocket event handlers.
   * @private
   */
  _bindSocketEvents() {
    if (!this.ws) return;

    this.ws.onopen = (event) => {
      console.info(`[GhostWebSocket] Connection established to ${this.url}`);
      this.reconnectAttempts = 0;
      this._setState('OPEN');
      this._startHeartbeat();
      this._flushMessageQueue();
      this.emit('open', event);
    };

    this.ws.onmessage = (event) => {
      this._handleIncomingMessage(event.data);
    };

    this.ws.onerror = (event) => {
      console.warn('[GhostWebSocket] Socket encountered an error:', event);
      this.emit('error', event);
    };

    this.ws.onclose = (event) => {
      console.warn(`[GhostWebSocket] Socket closed (code: ${event.code}, reason: ${event.reason || 'None'})`);
      this._stopHeartbeat();
      this._setState('CLOSED');
      this.emit('close', event);

      if (!this.isManualClosure) {
        this._scheduleReconnect();
      }
    };
  }

  /**
   * Parses and dispatches incoming WebSocket message frames.
   * Expects JSON payloads with an 'event' or 'type' field.
   * @private
   * @param {string} rawData 
   */
  _handleIncomingMessage(rawData) {
    let payload;
    try {
      payload = JSON.parse(rawData);
    } catch {
      // Fallback for non-JSON string payloads (e.g. simple pong responses)
      if (rawData === 'pong' || rawData === '{"type":"pong"}') {
        this.emit('pong', { timestamp: Date.now() });
        return;
      }
      this.emit('raw_message', rawData);
      return;
    }

    // Always emit the generic message event
    this.emit('message', payload);

    // Route typed events (supports payload.event, payload.type, or payload.action)
    const eventType = payload.event || payload.type || payload.action;
    if (eventType) {
      this.emit(eventType, payload.data !== undefined ? payload.data : payload);
    }
  }

  /**
   * Schedules an automatic reconnection with exponential backoff and jitter.
   * Backoff sequence: 1s, 2s, 4s, 8s, 16s, capped at maxReconnectDelay (30s).
   * @private
   */
  _scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const baseDelay = Math.min(
      this.initialReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );
    // Add 10-20% random jitter to avoid thundering herd on server restarts
    const jitter = Math.random() * (baseDelay * 0.2);
    const delay = Math.round(baseDelay + jitter);

    this.reconnectAttempts++;
    this._setState('RECONNECTING');

    console.info(`[GhostWebSocket] Reconnecting in ${delay}ms (attempt #${this.reconnectAttempts})...`);
    this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * Handles immediate connection creation exceptions.
   * @private
   */
  _handleConnectionFailure() {
    this._setState('CLOSED');
    this._scheduleReconnect();
  }

  /**
   * Starts sending periodic ping heartbeats every 30s.
   * @private
   */
  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({
          type: 'ping',
          timestamp: Date.now()
        });
      }
    }, this.heartbeatInterval);
  }

  /**
   * Stops active heartbeat timer.
   * @private
   */
  _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Transmits a message over the WebSocket. If the socket is offline,
   * enqueues message to transmit automatically when connection is restored.
   * @param {Object|string} message Data to send
   * @returns {boolean} True if sent immediately, false if queued
   */
  send(message) {
    const serialized = typeof message === 'string' ? message : JSON.stringify(message);

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(serialized);
        return true;
      } catch (err) {
        console.error('[GhostWebSocket] Failed to send frame:', err);
      }
    }

    // Queue outgoing messages when disconnected
    if (this.messageQueue.length >= this.maxQueueSize) {
      this.messageQueue.shift(); // Evict oldest frame to prevent unbounded memory growth
    }
    this.messageQueue.push(serialized);
    return false;
  }

  /**
   * Flushes queued outgoing messages upon successful socket reconnection.
   * @private
   */
  _flushMessageQueue() {
    if (this.messageQueue.length === 0) return;

    console.info(`[GhostWebSocket] Flushing ${this.messageQueue.length} queued messages...`);
    while (this.messageQueue.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msg = this.messageQueue.shift();
      try {
        this.ws.send(msg);
      } catch (err) {
        console.error('[GhostWebSocket] Error flushing queued message:', err);
        // Put back at head of queue
        this.messageQueue.unshift(msg);
        break;
      }
    }
  }

  /**
   * Cleanly closes the WebSocket connection and halts reconnection timers.
   */
  close(code = 1000, reason = 'Client closed normally') {
    this.isManualClosure = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._stopHeartbeat();
    this.messageQueue = [];

    if (this.ws) {
      this._setState('CLOSING');
      this.ws.close(code, reason);
    } else {
      this._setState('CLOSED');
    }
  }
}

// Attach to global window object for convenience
if (typeof window !== 'undefined') {
  window.GhostWebSocket = GhostWebSocket;
}
