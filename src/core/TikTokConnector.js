// src/core/TikTokConnector.js

const EventEmitter = require('events');
// const { fetchConnectionParams } = require('./URLScraper'); // <-- REMOVE OLD ONE
const { fetchConnectionParamsWithPuppeteer } = require('./PuppeteerScraper'); // <-- ADD NEW ONE
const TikTokWebsocket = require('./TikTokWebsocket'); // Assuming this is the correct path

const RECONNECT_DELAY_MS = 5000;

class TikTokConnector extends EventEmitter {
    #username;
    #websocket = null;
    #isConnecting = false;
    #isConnected = false;
    #shouldReconnect = false;
    #reconnectTimeout = null;

    constructor() {
        super();
    }

    get isConnected() {
        return this.#isConnected;
    }

    get currentUsername() {
        return this.#username;
    }

    async connect(username) {
        if (this.#isConnecting || this.#isConnected) {
            console.warn(`Connector is already connecting or connected to ${this.#username}.`);
            return;
        }

        this.#username = username.toLowerCase().replace('@', '');
        this.#isConnecting = true;
        this.#shouldReconnect = true; // Permitir reconexión automática a partir de ahora

        this.emit('connecting', { username: this.#username });

        try {
            console.log(`[${this.#username}] Fetching connection parameters using Puppeteer...`);
            
            // ====================================================================
            // HERE IS THE CHANGE: Using the new Puppeteer-based function
            // ====================================================================
            const params = await fetchConnectionParamsWithPuppeteer(this.#username);
            
            // The rest of the logic remains the same.
            console.log(`[${this.#username}] Parameters fetched. Connecting to WebSocket...`);
            
            // Note: Your TikTokWebsocket constructor expects 'cookies', which our function provides.
            // It also expects other params which seem to be empty in your example.
            this.#websocket = new TikTokWebsocket(params.websocketUrl, params.cookies, {}, {}, {}, {});
            
            this.#attachEventListeners();

        } catch (error) {
            console.error(`[${this.#username}] Failed to connect:`, error.message);
            this.emit('error', { message: error.message, originalError: error });
            this.#isConnecting = false;
            if (this.#shouldReconnect) {
                this.#scheduleReconnect();
            }
        }
    }

    disconnect(preventReconnect = true) {
        if (preventReconnect) {
            this.#shouldReconnect = false;
        }

        clearTimeout(this.#reconnectTimeout);
        
        if (this.#websocket) {
            this.#websocket.disconnect();
            this.#websocket = null;
        }

        if (this.#isConnected || this.#isConnecting) {
            this.#isConnected = false;
            this.#isConnecting = false;
            this.emit('disconnected', { username: this.#username, manually: preventReconnect });
            console.log(`[${this.#username}] Disconnected.`);
        }
    }

    #attachEventListeners() {
        this.#websocket.on('conectado', () => {
            this.#isConnected = true;
            this.#isConnecting = false;
            clearTimeout(this.#reconnectTimeout);
            this.emit('connected', { username: this.#username });
            console.log(`[${this.#username}] Successfully connected to WebSocket.`);
        });

        this.#websocket.on('disconnected', () => {
            const wasConnected = this.#isConnected;
            this.#isConnected = false;
            this.#isConnecting = false;
            if (wasConnected) {
                this.emit('disconnected', { username: this.#username, manually: false });
                console.log(`[${this.#username}] WebSocket connection lost.`);
            }
            if (this.#shouldReconnect) {
                this.#scheduleReconnect();
            }
        });

        this.#websocket.on('error', (error) => {
            this.emit('error', { message: 'WebSocket internal error', originalError: error });
            // Don't schedule reconnect here, 'disconnected' event will handle it
        });
        
        // Your existing protobuf handling logic is perfectly fine and doesn't need changes.
        // The puppeteer part is only for getting the initial connection data.
        this.#websocket.on('webcastResponse', (response) => {
            response.messages.forEach(message => {
                if (!message.decodedData) return;
                
                const eventMap = {
                    WebcastChatMessage: 'chat',
                    WebcastGiftMessage: 'gift',
                    WebcastLikeMessage: 'like',
                    WebcastMemberMessage: 'member',
                    WebcastSocialMessage: 'social',
                    WebcastRoomUserSeqMessage: 'roomUser',
                    WebcastSubNotifyMessage: 'subscribe',
                    WebcastEmoteChatMessage: 'emote'
                };

                const eventName = eventMap[message.type];
                if (eventName) {
                    // Assuming handleMessageDecoding is defined elsewhere
                    // const processedData = handleMessageDecoding(message.decodedData);
                    this.emit(eventName, message.decodedData); // Or processedData
                }

                if (message.type === 'WebcastControlMessage' && message.decodedData.action === 3) { // action:3 => Stream Ended
                    console.log(`[${this.#username}] Stream has ended.`);
                    this.emit('streamEnd', { username: this.#username, data: message.decodedData });
                    this.disconnect(true);
                }
            });
        });
    }

    #scheduleReconnect() {
        if (!this.#shouldReconnect || this.#reconnectTimeout || this.#isConnecting) return;

        this.#reconnectTimeout = setTimeout(async () => {
            this.#reconnectTimeout = null;
            if (this.#shouldReconnect && !this.#isConnected && !this.#isConnecting) {
                console.log(`[${this.#username}] Attempting to reconnect...`);
                this.emit('reconnecting', { username: this.#username });
                // We must use the public connect method to re-initiate the entire process,
                // including fetching new parameters with Puppeteer.
                await this.connect(this.#username);
            }
        }, RECONNECT_DELAY_MS);
    }
}

module.exports = { TikTokConnector };