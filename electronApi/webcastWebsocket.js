// WebcastWebsocket.js

const WebSocket = require('ws');
const EventEmitter = require('events');
const querystring = require('querystring');
const url = require('url');
const crypto = require('crypto');

// Importamos las funciones de decodificación/codificación desde nuestro módulo especializado
const {
  deserializeWebsocketMessage,
  serializeMessage
} = require('./messageDecoder');

// Constantes relacionadas con la conexión WebSocket
const CONSTANTS = {
  WEBSOCKET_HOST: 'webcast16-ws-useast1a.tiktok.com',
  ORIGIN_URL: 'https://www.tiktok.com',
  PING_INTERVAL: 10000,
  SELECTED_COOKIE_NAMES: [
    'ttwid',
    'tt_chain_token',
    'odin_tt',
    'sid_guard',
    'uid_tt',
    'bm_sv'
  ],
  HEADERS: {
    'Accept': '*/*',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive, Upgrade',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'websocket',
    'Sec-Fetch-Site': 'same-site',
    'Sec-WebSocket-Extensions': 'permessage-deflate',
    'Sec-WebSocket-Version': '13',
    'Upgrade': 'websocket',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0'
  }
};

class WebcastWebsocket extends EventEmitter {
  constructor(wsUrl, cookieJar, clientParams, wsParams, customHeaders, websocketOptions) {
    super();
    this.pingInterval = null;
    this.connection = null;
    this.wsParams = { ...clientParams, ...wsParams };
    this.cookies = this._filterAndFormatCookies(cookieJar);
    this.wsHeaders = { ...customHeaders };
    this.websocketOptions = websocketOptions;
    this.wsUrlWithParams = this._formatWsUrl(wsUrl);

    this._connect();
  }

  _formatWsUrl(wsUrl) {
    const parsedUrl = url.parse(decodeURI(wsUrl));
    const queryParams = querystring.parse(parsedUrl.query);
    queryParams.browser_version = '5.0 (Windows)';
    const newQueryString = querystring.stringify(queryParams);

    return url.format({
      protocol: parsedUrl.protocol,
      host: parsedUrl.host,
      pathname: parsedUrl.pathname,
      search: `?${newQueryString}`
    });
  }

  _connect() {
    const headers = {
      ...CONSTANTS.HEADERS,
      ...this.wsHeaders,
      'Cookie': this.cookies,
      'Host': CONSTANTS.WEBSOCKET_HOST,
      'Origin': CONSTANTS.ORIGIN_URL,
      'Sec-WebSocket-Key': this._generateSecWebSocketKey()
    };

    this._cleanupExistingConnection();
    console.log("Conectando a:", this.wsUrlWithParams);
    this.connection = new WebSocket(this.wsUrlWithParams, {
      headers: headers,
      ...this.websocketOptions
    });

    this._setupEventListeners();
  }

  _cleanupExistingConnection() {
    if (this.connection) {
      this.connection.removeAllListeners();
      this.connection.close();
      this.connection = null;
    }
  }

  _setupEventListeners() {
    this.connection.on('open', () => {
      this.emit('conectado', {});
      this.pingInterval = setInterval(() => this._sendPing(), CONSTANTS.PING_INTERVAL);
    });

    this.connection.on('message', (data) => {
      this._handleMessage(data);
    });

    this.connection.on('close', () => {
      clearInterval(this.pingInterval);
      this.emit("disconnected", {});
    });

    this.connection.on('error', (error) => {
      console.error('WebSocket error:', error.message);
      this.emit('error', error);
      this._cleanupExistingConnection();
    });
  }

  disconnect() {
    if (this.connection) {
      this.connection.close();
      clearInterval(this.pingInterval);
      this.connection = null;
    }
  }

  _filterAndFormatCookies(cookies) {
    return cookies
      .filter(cookie => CONSTANTS.SELECTED_COOKIE_NAMES.includes(cookie.name))
      .map(cookie => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }

  _generateSecWebSocketKey() {
    return crypto.randomBytes(16).toString('base64');
  }

  _handleMessage(data) {
    // La lógica de decodificación ahora está en una función asíncrona, la manejamos aquí.
    this._processBinaryMessage(data).catch(err => {
      this.emit('messageDecodingFailed', err);
    });
  }

  async _processBinaryMessage(binaryData) {
    // Usamos la función importada para decodificar el mensaje.
    // Toda la complejidad de Protobuf y Gzip está oculta en messageDecoder.js
    const decodedContainer = await deserializeWebsocketMessage(binaryData);

    if (decodedContainer.id > 0) {
      this._sendAck(decodedContainer.id);
    }

    if (decodedContainer.webcastResponse) {
      this.emit('webcastResponse', decodedContainer.webcastResponse);
    }
  }

  _sendPing() {
    if (this.connection && this.connection.readyState === WebSocket.OPEN) {
      this.connection.ping();
    }
  }

  _sendAck(id) {
    if (this.connection && this.connection.readyState === WebSocket.OPEN) {
      // Usamos la función importada para serializar el mensaje de ACK.
      const ackMsg = serializeMessage('WebcastWebsocketAck', {
        type: 'ack',
        id
      });
      this.connection.send(ackMsg);
    }
  }
}

module.exports = WebcastWebsocket;