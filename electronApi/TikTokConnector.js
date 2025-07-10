// api/TikTokConnector.js

const EventEmitter = require('events');
// Use the refactored class and its events enum
const { TikTokConnection, EVENTS: TikTokConnectionEvents } = require('./tiktokConnection');

// Define the events this high-level connector will emit
const ConnectorEvents = Object.freeze({
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    RECONNECTING: 'reconnecting',
    STREAM_END: 'streamEnd',
    ERROR: 'error',

    // Data Events (re-emitted from TikTokConnection)
    ...TikTokConnectionEvents, // Spread all events from the underlying connection

    // Connector-specific events
    STICKERS_UPDATED: 'stickersUpdated',
    GIFTS_UPDATED: 'giftsUpdated',
});

const RECONNECT_BASE_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;

class TikTokConnector extends EventEmitter {
    // Private properties to manage state and the underlying connection
    #browserManager;
    #connection = null;
    #currentUsername = null;
    #isConnecting = false;
    #isConnected = false;
    #shouldReconnect = false;
    #reconnectTimeoutId = null;
    #reconnectAttempts = 0;

    /**
     * Initializes the TikTok Connector service.
     * @param {object} browserManager A manager for creating browser windows (e.g., your Electron Ventanas class).
     */
    constructor(browserManager) {
        super();
        if (!browserManager) {
            throw new Error("TikTokConnector requires a browserManager instance.");
        }
        this.#browserManager = browserManager;
    }

    /**
     * Connects to a TikTok user's live stream.
     * @param {string} username The TikTok username (e.g., "tiktok").
     * @throws {Error} If the connection fails for any reason (e.g., user not live, network error).
     */
    async connect(username) {
        if (this.#isConnecting) {
            console.warn(`TikTokConnector: Connection attempt ignored. Already connecting to @${this.#currentUsername}.`);
            return;
        }

        if (this.#isConnected && this.#currentUsername === username.toLowerCase()) {
            console.warn(`TikTokConnector: Connection attempt ignored. Already connected to @${this.#currentUsername}.`);
            return;
        }

        // If connecting to a new user, disconnect the old session first.
        if (this.#isConnected) {
            await this.disconnect();
        }

        this.#isConnecting = true;
        this.#shouldReconnect = true; // Enable auto-reconnect for this session
        this.#currentUsername = username.toLowerCase().replace(/@/g, "");
        
        // If this is a reconnect attempt, emit 'reconnecting', otherwise 'connecting'
        if (this.#reconnectAttempts > 0) {
            this.emit(ConnectorEvents.RECONNECTING, { attempt: this.#reconnectAttempts, username: this.#currentUsername });
            console.log(`TikTokConnector: Reconnecting to @${this.#currentUsername} (Attempt #${this.#reconnectAttempts})...`);
        } else {
            this.emit(ConnectorEvents.CONNECTING, { username: this.#currentUsername });
            console.log(`TikTokConnector: Attempting to connect to @${this.#currentUsername}...`);
        }

        try {
            // Create a new connection instance
            this.#connection = new TikTokConnection(this.#currentUsername, this.#browserManager);
            this.#attachEventListeners();

            // The underlying connect method will throw an error on failure
            await this.#connection.connect();
            
            // The 'connected' event from the instance will finalize the state.
            // This method resolves once the connection process has been successfully initiated.

        } catch (error) {
            console.error(`TikTokConnector: Failed to connect to @${this.#currentUsername}.`, error);
            await this.disconnect(false); // Clean up the failed attempt, but allow future manual connects
            this.emit(ConnectorEvents.ERROR, { message: error.message, originalError: error });
            throw error; // Re-throw the error for the caller to handle
        }
    }

    /**
     * Disconnects the current TikTok connection and optionally prevents reconnection.
     * @param {boolean} [preventReconnect=true] If true, stops automatic reconnection attempts.
     */
    async disconnect(preventReconnect = true) {
        console.log(`TikTokConnector: Disconnecting from @${this.#currentUsername}. Prevent Reconnect: ${preventReconnect}`);
        
        if (preventReconnect) {
            this.#shouldReconnect = false;
        }

        clearTimeout(this.#reconnectTimeoutId);
        this.#reconnectTimeoutId = null;

        const wasConnected = this.#isConnected;
        this.#isConnecting = false;
        this.#isConnected = false;

        if (this.#connection) {
            const conn = this.#connection;
            this.#connection = null; // Nullify reference immediately
            conn.removeAllListeners(); // IMPORTANT: Remove listeners to prevent stray events
            conn.disconnect();
        }

        // Only emit a public 'disconnected' event if it was truly connected or a manual disconnect was called.
        if (wasConnected || preventReconnect) {
            this.emit(ConnectorEvents.DISCONNECTED, { manuallyTriggered: preventReconnect, username: this.#currentUsername });
        }
        
        this.#currentUsername = null;
        this.#reconnectAttempts = 0;
    }

    /**
     * Fetches the gift list for the currently connected stream.
     * @returns {Promise<Array<Object>>} A list of gift objects.
     * @throws {Error} If not connected.
     */
    async fetchGifts() {
        if (!this.#isConnected || !this.#connection) {
            throw new Error("Cannot fetch gifts. Connector is not connected.");
        }
        try {
            console.log(`TikTokConnector: Fetching gift list for @${this.#currentUsername}...`);
            const giftList = await this.#connection.fetchGiftList();
            this.emit(ConnectorEvents.GIFTS_UPDATED, giftList);
            return giftList;
        } catch (error) {
            console.error(`TikTokConnector: Failed to fetch gifts for @${this.#currentUsername}:`, error);
            this.emit(ConnectorEvents.ERROR, { message: `Gift fetch failed: ${error.message}`, originalError: error });
            return []; // Return empty list on error
        }
    }

    /**
     * Fetches stickers/emotes for the currently connected stream.
     * @throws {Error} If not connected.
     */
    async fetchStickers() {
        if (!this.#isConnected || !this.#connection) {
            throw new Error("Cannot fetch stickers. Connector is not connected.");
        }
        try {
            console.log("TikTokConnector: Fetching stickers...");
            // The callback will emit the STICKERS_UPDATED event
            await this.#connection.fetchStickers((stickers) => {
                console.log(`TikTokConnector: Stickers received (${stickers?.length || 0}).`);
                this.emit(ConnectorEvents.STICKERS_UPDATED, stickers);
            });
        } catch (error) {
            console.error(`TikTokConnector: Failed to fetch stickers for @${this.#currentUsername}:`, error);
            this.emit(ConnectorEvents.ERROR, { message: `Sticker fetch failed: ${error.message}`, originalError: error });
        }
    }

    get isConnected() {
        return this.#isConnected;
    }

    get currentUsername() {
        return this.#currentUsername;
    }

    // --- Private Methods ---

    #attachEventListeners() {
        if (!this.#connection) return;

        // --- Connection State Events ---
        this.#connection.on(TikTokConnectionEvents.CONNECTED, (data) => {
            console.log(`TikTokConnector: Successfully connected to @${this.#currentUsername}.`);
            this.#isConnected = true;
            this.#isConnecting = false;
            this.#reconnectAttempts = 0; // Reset on success
            clearTimeout(this.#reconnectTimeoutId);
            this.emit(ConnectorEvents.CONNECTED, { ...data, username: this.#currentUsername });
        });

        this.#connection.on(TikTokConnectionEvents.DISCONNECTED, (reason) => {
            const wasConnected = this.#isConnected;
            this.#isConnected = false;
            this.#isConnecting = false;

            if (wasConnected) {
                console.log(`TikTokConnector: Connection lost for @${this.#currentUsername}. Reason:`, reason);
                this.emit(ConnectorEvents.DISCONNECTED, { ...reason, username: this.#currentUsername });
            }

            if (this.#shouldReconnect) {
                this.#scheduleReconnect();
            }
        });

        this.#connection.on(TikTokConnectionEvents.STREAM_END, (data) => {
            console.log(`TikTokConnector: Stream ended by host @${this.#currentUsername}.`);
            this.emit(ConnectorEvents.STREAM_END, { ...data, username: this.#currentUsername });
            this.disconnect(true); // Disconnect and prevent any further reconnects
        });

        // --- Data Events (Forwarding) ---
        // List of events from TikTokConnection to forward directly
        const eventsToForward = [
            'CHAT', 'LIKE', 'GIFT', 'FOLLOW', 'SHARE', 'SUBSCRIBE', 'MEMBER', 'ROOM_USER', 'EMOTE', 'SOCIAL'
        ];

        eventsToForward.forEach(eventKey => {
            const eventName = TikTokConnectionEvents[eventKey];
            if (eventName) {
                this.#connection.on(eventName, (data) => {
                    this.emit(eventName, data); // Re-emit the event from this connector
                });
            }
        });
    }

    #scheduleReconnect() {
        if (this.#reconnectTimeoutId || !this.#shouldReconnect || this.#isConnecting) {
            return; // Already scheduled, not allowed, or in the process of connecting
        }

        if (this.#reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            console.error(`TikTokConnector: Reached max reconnect attempts for @${this.#currentUsername}. Giving up.`);
            this.emit(ConnectorEvents.ERROR, { message: "Max reconnect attempts reached." });
            this.disconnect(true); // Give up
            return;
        }

        this.#reconnectAttempts++;
        // Exponential backoff with a cap
        const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, Math.min(this.#reconnectAttempts, 4));
        
        console.log(`TikTokConnector: Scheduling reconnect in ${delay / 1000}s...`);

        this.#reconnectTimeoutId = setTimeout(async () => {
            this.#reconnectTimeoutId = null;
            if (!this.#shouldReconnect || this.#isConnected) {
                console.log("TikTokConnector: Reconnect cancelled (no longer required or already connected).");
                return;
            }
            try {
                await this.connect(this.#currentUsername);
            } catch (error) {
                // The connect method already handles error logging and event emission.
                // If it fails, it will trigger the 'disconnected' flow, which will schedule the *next* reconnect.
            }
        }, delay);
    }
}

module.exports = { TikTokConnector, ConnectorEvents };