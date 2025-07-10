// webcastWebsocket.js

const WebSocket = require('ws');
const EventEmitter = require('events');
const crypto = require('crypto');
const { deserializeWebsocketMessage, serializeMessage } = require('./messageDecoder');

const WEBSOCKET_DEFAULTS = {
  pingInterval: 10000,
  origin: 'https://www.tiktok.com',
  headers: {
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Connection': 'Upgrade',
    'Pragma': 'no-cache',
    'Upgrade': 'websocket',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
  },
  // Cookies that are essential for the connection
  requiredCookieNames: [
    'ttwid',
    'tt_chain_token',
    'odin_tt',
    'sid_guard',
    'uid_tt',
    'bm_sv'
  ],
};

class WebcastWebsocket extends EventEmitter {
  /**
   * Creates a new WebSocket connection to a TikTok LIVE stream.
   * @param {string} wsUrl The full WebSocket URL for the connection.
   * @param {object} options Configuration options.
   * @param {Array<object>} options.cookies An array of cookie objects from Electron/Puppeteer.
   * @param {object} [options.customHeaders={}] Additional headers to include.
   * @param {object} [options.websocketOptions={}] Options passed directly to the 'ws' library.
   */
  constructor(wsUrl, options) {
    super();
    
    this.wsUrl = this._prepareWsUrl(wsUrl);
    this.options = { ...WEBSOCKET_DEFAULTS, ...options };
    
    this.connection = null;
    this.pingIntervalId = null;

    this._connect();
  }

  /**
   * Disconnects the WebSocket and cleans up resources.
   */
  disconnect() {
    if (this.connection) {
      this.connection.close();
      // Event listeners are automatically removed on 'close'
    }
  }

  /**
   * [Private] Prepares the WebSocket URL by ensuring required parameters are present.
   * @param {string} wsUrl - The initial WebSocket URL.
   * @returns {string} The formatted URL.
   * @private
   */
  _prepareWsUrl(wsUrl) {
    const url = new URL(decodeURI(wsUrl));
    // TikTok may require specific params, ensure they are set
    url.searchParams.set('browser_version', '5.0 (Windows)');
    return url.toString();
  }

  /**
   * [Private] Establishes the WebSocket connection.
   * @private
   */
  _connect() {
    this._cleanup(); // Ensure no old connection exists

    const headers = {
      ...this.options.headers,
      ...this.options.customHeaders,
      'Cookie': this._getCookieString(),
      'Host': new URL(this.wsUrl).host,
      'Origin': this.options.origin,
      'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
    };

    console.log(`Connecting to WebSocket at ${this.wsUrl}`);
    this.connection = new WebSocket(this.wsUrl, {
      headers,
      ...this.options.websocketOptions,
    });

    this._setupEventListeners();
  }

  /**
   * [Private] Sets up all event listeners for the WebSocket connection.
   * @private
   */
  _setupEventListeners() {
    this.connection.on('open', () => {
      this.emit('connected');
      this.pingIntervalId = setInterval(() => this._sendPing(), this.options.pingInterval);
    });

    this.connection.on('message', (data) => {
      this._processMessage(data).catch(err => {
        this.emit('messageDecodingFailed', err);
      });
    });

    this.connection.on('close', (code, reason) => {
      this._cleanup();
      this.emit('disconnected', { code, reason: reason.toString() });
    });

    this.connection.on('error', (error) => {
      console.error('WebSocket Error:', error.message);
      this.emit('error', error);
      this._cleanup();
    });
  }

  /**
   * [Private] Processes an incoming binary message from the WebSocket.
   * @param {Buffer} binaryData - The raw message data.
   * @private
   */
  async _processMessage(binaryData) {
    const decodedContainer = await deserializeWebsocketMessage(binaryData);

    if (decodedContainer.id > 0) {
      this._sendAck(decodedContainer.id);
    }

    if (decodedContainer.webcastResponse) {
      this.emit('webcastResponse', decodedContainer.webcastResponse);
    }
  }

  /**
   * [Private] Sends a ping to keep the connection alive.
   * @private
   */
  _sendPing() {
    if (this.connection?.readyState === WebSocket.OPEN) {
      this.connection.ping();
    }
  }

  /**
   * [Private] Sends an acknowledgement message for a received container.
   * @param {number} id - The ID of the message to acknowledge.
   * @private
   */
  _sendAck(id) {
    if (this.connection?.readyState === WebSocket.OPEN) {
      const ackMsg = serializeMessage('WebcastWebsocketAck', { type: 'ack', id });
      this.connection.send(ackMsg);
    }
  }

  /**
   * [Private] Formats the cookie array into a string for the request header.
   * @returns {string} The formatted cookie string.
   * @private
   */
  _getCookieString() {
    if (!this.options.cookies) return '';
    return this.options.cookies
      .filter(cookie => this.options.requiredCookieNames.includes(cookie.name))
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }

  /**
   * [Private] Cleans up the connection and any intervals.
   * @private
   */
  _cleanup() {
    if (this.pingIntervalId) {
      clearInterval(this.pingIntervalId);
      this.pingIntervalId = null;
    }
    if (this.connection) {
      this.connection.removeAllListeners();
      if (this.connection.readyState !== WebSocket.CLOSED) {
        this.connection.terminate();
      }
      this.connection = null;
    }
  }
}

module.exports = WebcastWebsocket;