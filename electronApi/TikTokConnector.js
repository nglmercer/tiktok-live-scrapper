// api/TikTokConnector.js
const EventEmitter = require('events');
const ConexionTiktok = require('./ConexionTiktok'); // Assuming ConexionTiktok is in the same directory

// Define event names that this connector will emit
const ConnectorEvents = Object.freeze({
    // Connection Status Events
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    RECONNECTING: 'reconnecting',
    STREAM_END: 'streamEnd',
    ERROR: 'error',

    // Data Events (re-emitted from ConexionTiktok)
    GIFT: 'gift',
    LIKE: 'like',
    FOLLOW: 'follow',
    CHAT: 'chat',
    SOCIAL: 'social',       // Includes share events
    SUBSCRIBE: 'subscribe',
    MEMBER: 'member',       // Join events
    ROOM_USER: 'roomUser',  // Viewer count updates, etc.
    EMOTE: 'emote',         // Specific emote messages
    // Add other events from ConexionTiktok if needed (QUESTION_NEW, etc.)

    // Connector Specific Events
    STICKERS_UPDATED: 'stickersUpdated',
    GIFTS_UPDATED: 'giftsUpdated', // If fetching gifts is managed here
});

const RECONNECT_DELAY_MS = 5000; // Delay before attempting reconnection

class TikTokConnector extends EventEmitter {
    #electronVentanas; // Reference to the Ventanas class instance or similar

    #connection = null;
    #currentUsername = null;
    #currentMethod = null;
    #isConnected = false;
    #isConnecting = false; // More specific than isConnected for initial phase
    #shouldReconnect = false; // Controlled externally by start/stop
    #reconnectTimeout = null;
    #reconnectAttempts = 0;
    #allevents = ["gift", "like", "follow", "chat", "social", "subscribe", "member", "roomUser", "emote"]

    /**
     * Initializes the TikTok Connector service.
     * @param {object} electronVentanas Reference to the Electron window manager class (Ventanas).
     */
    constructor(electronVentanas) {
        super();
        if (!electronVentanas) {
            throw new Error("TikTokConnector require electronVentanas.");
        }
        this.#electronVentanas = electronVentanas;
    }

    /**
     * Attempts to connect to the specified TikTok user's live stream.
     * @param {string} username The TikTok username (without @).
     * @param {'remote' | 'local'} method The connection method to use.
     * @returns {Promise<{res: 'ok' | 'error', text?: string, evento?: string}>} Promise resolving on successful WebSocket connection or rejecting on failure.
     */
    async connect(username, method) {
        if (this.#isConnecting || this.#isConnected) {
            const status = this.#isConnected ? 'connected' : 'connecting';
            console.warn(`TikTokConnector: Connection attempt ignored. Already ${status} to ${this.#currentUsername}.`);
            return { res: 'ok', text: `Already ${status}` };
        }

        this.#isConnecting = true;
        this.#shouldReconnect = true; // Allow automatic reconnections after this point
        this.#currentUsername = username.toLowerCase().replace(/@/g, ""); // Store normalized username
        this.#currentMethod = method;
        this.#reconnectAttempts = 0; // Reset attempts on new connect call
        clearTimeout(this.#reconnectTimeout); // Clear any pending reconnect timer

        this.emit(ConnectorEvents.CONNECTING, { username: this.#currentUsername, method });
        console.log(`TikTokConnector: Attempting connection to @${this.#currentUsername} via ${method}...`);

        try {
            // Clean up any previous instance, though connect should ideally only be called once initially
            if (this.#connection) {
                 console.warn("TikTokConnector: Found existing connection instance during connect. Disconnecting previous one.");
                 await this.#connection.disconnect(); // Ensure cleanup
                 this.#connection = null;
            }

            this.#connection = new ConexionTiktok(
                this.#currentUsername,
                this.#electronVentanas // Pass the window manager instance
            );

            this.#attachEventListeners();

            // ConexionTiktok's connect method already checks live status etc.
            const connectionResult = await this.#connection.connect(method);

            // Note: The 'connected' event from ConexionTiktok will handle setting #isConnected = true
            // If connect resolves successfully, it means the WS connection process started.
            if (connectionResult.res === 'ok') {
                 console.log(`TikTokConnector: Initial connection process for @${this.#currentUsername} successful. Waiting for WebSocket confirmation.`);
                 // Fetch initial stickers after successful connection initiation
                 // We resolve here, the 'connected' event will signify WS is truly open
                 this.#isConnecting = false; // WS might not be open *yet*, but setup is done
                 return connectionResult;
            } else {
                 // Connection failed during the setup phase (e.g., user not live, signing error)
                 console.error(`TikTokConnector: Connection setup failed for @${this.#currentUsername}. Reason:`, connectionResult);
                 await this.disconnect(false); // Clean up failed attempt, don't prevent future connects
                 throw new Error(connectionResult.text || 'Connection setup failed'); // Propagate error
            }

        } catch (error) {
            console.error(`TikTokConnector: Critial error during connection to @${this.#currentUsername}:`, error);
            await this.disconnect(false); // Ensure cleanup on error
            this.emit(ConnectorEvents.ERROR, { message: error.message, originalError: error });
            return { res: 'error', text: error.message, evento: error.evento || 'connection_error' }; // Return error structure
        }
    }

    /**
     * Disconnects the current TikTok connection.
     * @param {boolean} [preventReconnect=true] If true, stops automatic reconnection attempts.
     */
    async disconnect(preventReconnect = true) {
        console.log(`TikTokConnector: Disconnecting from @${this.#currentUsername}. Prevent Reconnect: ${preventReconnect}`);
        if (preventReconnect) {
            this.#shouldReconnect = false;
        }
        clearTimeout(this.#reconnectTimeout); // Stop any pending reconnection

        this.#isConnecting = false; // No longer trying to connect
        this.#isConnected = false; // Mark as disconnected

        if (this.#connection) {
            const conn = this.#connection;
            this.#connection = null; // Nullify reference first
            try {
                // Remove listeners before disconnecting to avoid stray events
                conn.removeAllListeners(); // Remove all listeners from the old instance
                await conn.disconnect(); // Call the underlying disconnect
            } catch (err) {
                console.warn(`TikTokConnector: Error during underlying disconnect: ${err.message}`);
            }
        }

        // Only emit if it wasn't already disconnected? Or always emit on manual call?
        // Let's emit always on manual call for clarity.
        this.emit(ConnectorEvents.DISCONNECTED, { manuallyTriggered: preventReconnect });
    }

    /** Fetches stickers using the current connection. */
    async fetchStickers() {
        if (!this.#connection || !this.#isConnected) { // Need to be connected to fetch stickers usually
            console.warn("TikTokConnector: Cannot fetch stickers, not connected.");
            return;
        }
        try {
            console.log("TikTokConnector: Requesting sticker fetch...");
            // The callback handles the result
            await this.#connection.obtenerStickers((stickers) => {
                 console.log(`TikTokConnector: Stickers received (${stickers?.length || 0}).`);
                 this.emit(ConnectorEvents.STICKERS_UPDATED, stickers);
            });
        } catch (error) {
            console.error(`TikTokConnector: Failed to fetch stickers for @${this.#currentUsername}:`, error);
        }
    }

     /** Fetches gifts using the current connection or username. */
     async fetchGifts() {
         let giftList = [];
         try {
             console.log(`TikTokConnector: Requesting gift list for @${this.#currentUsername || 'unknown user'}...`);
             // Create a temporary connection just for fetching gifts if not connected? Risky.
             // Assume we need the main connection or at least the username.
             if (this.#connection) {
                 giftList = await this.#connection.obtenerRegalos();
             } else if (this.#currentUsername) {
                 // Create a temporary instance ONLY for gift fetching if absolutely necessary
                 // This might require extra cookies or fail often. Better to fetch when connected.
                 console.warn("TikTokConnector: Fetching gifts without an active connection instance. Creating temporary.");
                 const tempConn = new ConexionTiktok(this.#currentUsername, this.#electronVentanas);
                 giftList = await tempConn.obtenerRegalos();
                 // No need to keep tempConn alive
             } else {
                  console.error("TikTokConnector: Cannot fetch gifts - no username or connection.");
                  return [];
             }

             console.log(`TikTokConnector: Gifts received (${giftList?.length || 0}).`);
             this.emit(ConnectorEvents.GIFTS_UPDATED, giftList);
             return giftList;
         } catch (error) {
             console.error(`TikTokConnector: Failed to fetch gifts for @${this.#currentUsername}:`, error);
             this.emit(ConnectorEvents.ERROR, { message: `Gift fetch failed: ${error.message}`, originalError: error });
             return []; // Return empty list on error
         }
     }

    /** Gets the current connection status. */
    get isConnected() {
        return this.#isConnected;
    }

    /** Gets the username currently being connected to or connected. */
    get currentUsername() {
        return this.#currentUsername;
    }

    // --- Private Methods ---

    /** Attaches event listeners to the ConexionTiktok instance. */
    #attachEventListeners() {
        if (!this.#connection) return;

        // Remove previous listeners if any (shouldn't be needed if #connection is managed properly)
        this.#connection.removeAllListeners();

        // --- Connection Status Events ---
        this.#connection.on('connected', () => { // Assuming 'connected' is emitted by ConexionTiktok WS wrapper
            console.log(`TikTokConnector: WebSocket connected for @${this.#currentUsername}.`);
            this.#isConnected = true;
            this.#isConnecting = false;
            this.#reconnectAttempts = 0; // Reset attempts on successful connect/reconnect
            clearTimeout(this.#reconnectTimeout);
            this.emit(ConnectorEvents.CONNECTED, { username: this.#currentUsername });
        });

        this.#connection.on('disconnected', (reason) => {
            console.log(`TikTokConnector: Underlying connection disconnected for @${this.#currentUsername}. Reason:`, reason);
            const wasConnected = this.#isConnected;
            this.#isConnected = false;
            this.#isConnecting = false; // Definitely not connecting if disconnected

            if (wasConnected) { // Only emit if it was previously properly connected
                 this.emit(ConnectorEvents.DISCONNECTED, reason);
            }

            // Handle Reconnection
            if (this.#shouldReconnect) {
                this.#scheduleReconnect();
            }
        });

        this.#connection.on('streamEnd', (data) => {
            console.log(`TikTokConnector: Stream ended for @${this.#currentUsername}.`);
            this.#shouldReconnect = false; // Don't reconnect if stream officially ended
            this.emit(ConnectorEvents.STREAM_END, data);
            // Disconnect locally after stream end event is emitted
            this.disconnect(true); // Prevent auto-reconnect attempts
        });

        this.#connection.on('error', (errorData) => { // General errors from ConexionTiktok
            console.error(`TikTokConnector: Error received for @${this.#currentUsername}:`, errorData?.text || errorData);
             // If the error occurs during initial connection, #isConnecting might still be true
            if (this.#isConnecting) {
                this.#isConnecting = false;
                // Potentially reject the initial connect promise here or rely on connect method's catch block
            }
             this.emit(ConnectorEvents.ERROR, {
                 message: errorData?.text || 'Unknown connection error',
                 originalError: errorData,
                 evento: errorData?.evento // Pass along specific event type if provided
             });
             // Decide if error warrants attempting reconnection
             if (this.#isConnected || this.#isConnecting || this.#shouldReconnect) { // If we were connected or trying to be
                 // Maybe check error type before reconnecting?
                 // For now, assume most errors should trigger a reconnect attempt if allowed
                 this.#isConnected = false; // Ensure marked as disconnected
                 this.#isConnecting = false;
                 if (this.#shouldReconnect) {
                      this.#scheduleReconnect();
                 }
             }
        });

        // --- Data Events (Re-emit) ---
        // Simple re-emission, potentially adding context if needed later
            const allevents = this.#allevents;
            allevents.forEach(event => {
                this.#connection.on(event, (data) => {
                    // CORRECCIÓN: Usa la variable 'event' directamente, que ya tiene el nombre correcto ('gift', 'like', etc.)
                    this.emit(event, data);
                });
            });
        // Add listeners for other events from ConexionTiktok here...
    }

    /** Schedules a reconnection attempt. */
    #scheduleReconnect() {
        if (this.#reconnectTimeout || !this.#shouldReconnect || this.#isConnecting || this.#isConnected) {
            // Don't schedule if already scheduled, not allowed, connecting, or already connected
            return;
        }

        this.#reconnectAttempts++;
        const delay = RECONNECT_DELAY_MS * Math.min(this.#reconnectAttempts, 6); // Basic exponential backoff (max ~30s delay)
        console.log(`TikTokConnector: Scheduling reconnect attempt ${this.#reconnectAttempts} in ${delay / 1000}s for @${this.#currentUsername}...`);
        this.emit(ConnectorEvents.RECONNECTING, { attempt: this.#reconnectAttempts, delay });

        this.#reconnectTimeout = setTimeout(async () => {
            this.#reconnectTimeout = null;
            if (!this.#shouldReconnect || this.#isConnected || this.#isConnecting) {
                console.log("TikTokConnector: Reconnect cancelled (shouldReconnect=false or already connected/connecting).");
                return;
            }
            console.log(`TikTokConnector: Attempting reconnect #${this.#reconnectAttempts} for @${this.#currentUsername}...`);
            // Use the stored username and method for reconnection
            await this.connect(this.#currentUsername, this.#currentMethod);
        }, delay);
    }
}

module.exports = { TikTokConnector, ConnectorEvents }; // Export class and events enum