// tiktokConnection.js

const EventEmitter = require("events");
const axios = require("axios");
const { session } = require("electron");
const WebcastWebsocket = require("./webcastWebsocket");
const { parseStickerData, handleMessageDecoding } = require("./tiktokUtils");

// Constants for events
const EVENTS = {
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  ERROR: "error",
  STREAM_END: "streamEnd",
  // Specific data events
  CHAT: "chat",
  MEMBER: "member",
  GIFT: "gift",
  ROOM_USER: "roomUser",
  SOCIAL: "social",
  LIKE: "like",
  QUESTION_NEW: "questionNew",
  LINK_MIC_BATTLE: "linkMicBattle",
  LINK_MIC_ARMIES: "linkMicArmies",
  LIVE_INTRO: "liveIntro",
  EMOTE: "emote",
  ENVELOPE: "envelope",
  SUBSCRIBE: "subscribe",
  // Social sub-events
  FOLLOW: "follow",
  SHARE: "share",
};

class TikTokConnection extends EventEmitter {
  constructor(username, browserManager) {
    super();
    this.username = username;
    this.browserManager = browserManager; // Manages browser instances

    // State
    this.isConnected = false;
    this.isConnecting = false;
    this.shouldReconnect = false;

    // Connection data
    this.websocket = null;
    this.browserWindow = null;
    this.roomId = null;
    this.cookies = null;
    this.connectionData = {
      wsUrl: null,
      stickerUrl: null,
      cookies: null,
    };
    
    // Gift/Sticker data
    this.stickers = [];
  }

  /**
   * Connects to the TikTok LIVE stream.
   * @throws {Error} If the user is offline or the connection fails.
   */
  async connect() {
    if (this.isConnecting || this.isConnected) {
      console.warn("Connection attempt ignored: already connecting or connected.");
      return;
    }

    this.isConnecting = true;

    try {
      const roomInfo = await this.fetchRoomInfo();
      if (roomInfo.status !== 2) { // 2 = LIVE, 4 = OFFLINE/Not Found
        throw new Error(`Streamer @${this.username} is not live (status: ${roomInfo.status}).`);
      }
      this.roomId = roomInfo.roomId;

      // Capture WebSocket URL and cookies by briefly opening a browser window
      this.connectionData = await this._captureConnectionData();
      
      // Update URL params as required by TikTok
      const url = new URL(this.connectionData.wsUrl);
      url.searchParams.set("client_enter", "0");
      this.connectionData.wsUrl = url.toString();

      // Establish the WebSocket connection
      await this._connectWebSocket();

      this.isConnected = true;
      this.emit(EVENTS.CONNECTED, { roomId: this.roomId });

    } catch (error) {
      this.isConnecting = false;
      this.emit(EVENTS.ERROR, error);
      throw error; // Re-throw for the caller to handle
    } finally {
      this.isConnecting = false;
    }
  }

  /**
   * Disconnects from the WebSocket.
   */
  disconnect() {
    if (this.websocket) {
      this.shouldReconnect = false;
      this.websocket.disconnect();
    }
  }

  /**
   * Fetches the current room status and ID for the user.
   * @returns {Promise<{status: number, roomId: string}>}
   */
  async fetchRoomInfo() {
    try {
      const response = await axios.get(`https://www.tiktok.com/api-live/user/room/`, {
        params: {
          aid: 1988,
          sourceType: 54,
          uniqueId: this.username,
        },
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
        },
      });

      const user = response.data?.data?.user;
      if (!user) {
        throw new Error("User not found or invalid API response.");
      }

      return { status: user.status, roomId: user.roomId };
    } catch (error) {
      throw new Error(`Failed to fetch room info for @${this.username}: ${error.message}`);
    }
  }

  /**
   * Fetches the list of available gifts for the current room.
   * @returns {Promise<Array<Object>|null>} A unique list of gift objects.
   */
  async fetchGiftList() {
    if (!this.roomId) {
      throw new Error("Cannot fetch gift list without a valid room ID. Please connect first.");
    }

    const url = new URL("https://webcast.tiktok.com/webcast/gift/list/");
    url.search = new URLSearchParams({
      aid: 1988,
      room_id: this.roomId,
      app_language: 'en-US',
      // Add other necessary params here if needed
    }).toString();

    try {
      const response = await axios.get(url.toString());
      const giftPages = response.data?.data?.pages || [];
      const topGifts = response.data?.data?.gifts || [];
      
      const allGifts = [...topGifts];
      giftPages.forEach(page => allGifts.push(...(page.gifts || [])));

      // Return a unique list of gifts by ID
      return Array.from(new Map(allGifts.map(gift => [gift.id, gift])).values());
    } catch (error) {
      console.error("Failed to fetch gift list:", error);
      return null;
    }
  }

  /**
   * Fetches sticker/emote data.
   * @param {Function} callback - The callback function to process sticker data.
   */
  async fetchStickers(callback) {
    if (!this.connectionData.stickerUrl || !this.connectionData.cookies) {
      throw new Error("Sticker URL or cookies not available. Must connect first.");
    }

    try {
      const cookieString = this.connectionData.cookies.map(c => `${c.name}=${c.value}`).join("; ");
      const response = await axios.get(this.connectionData.stickerUrl, {
        headers: { Cookie: cookieString },
      });
      
      // Util function handles the parsing
      parseStickerData(response.data, callback, this.stickers);
    } catch (error) {
      throw new Error(`Failed to fetch stickers: ${error.message}`);
    }
  }

  /**
   * [Private] Captures WebSocket URL, sticker URL, and cookies by intercepting network requests.
   * This is a sensitive operation and is now more robust with a timeout and listener cleanup.
   * @returns {Promise<{wsUrl: string, stickerUrl: string, cookies: Array<Object>}>}
   * @private
   */
  _captureConnectionData() {
    return new Promise((resolve, reject) => {
      let capturedData = { wsUrl: null, stickerUrl: null, cookies: null };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Connection data capture timed out after 30 seconds."));
      }, 30000); // 30-second timeout

      const listener = async (details, callback) => {
        const isWsUrl = details.url.includes("webcast") && details.url.includes("tiktok.com") && details.url.startsWith("ws");
        const isStickerUrl = details.url.includes("get_sub_emote_detail");
        if (isWsUrl) {
          console.log(`Captured URL: ${details.url}`,isWsUrl);
          capturedData.wsUrl = details.url;
          capturedData.cookies = await session.defaultSession.cookies.get({ url: "https://www.tiktok.com" });
        } else if (isStickerUrl) {
          capturedData.stickerUrl = details.url;
        }

        // If all required data is captured, resolve the promise
        if (capturedData.wsUrl && capturedData.stickerUrl && capturedData.cookies) {
          cleanup();
          resolve(capturedData);
        }
        
        callback({ cancel: false });
      };

      const cleanup = () => {
        clearTimeout(timeout);
        session.defaultSession.webRequest.onBeforeRequest(null); // Remove listener
        if (this.browserWindow) {
          this.browserWindow.close();
          this.browserWindow = null;
        }
      };

      // Start listening to requests
      session.defaultSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, listener);
      
      // Open the browser to trigger the requests
      this.browserWindow = this.browserManager.createWindow(`https://www.tiktok.com/@${this.username}/live`);
    });
  }

  /**
   * [Private] Initializes the WebSocket connection and sets up event listeners.
   * @private
   */
  _connectWebSocket() {
    return new Promise((resolve, reject) => {
      if (this.websocket) {
        this.websocket.disconnect();
      }

      this.websocket = new WebcastWebsocket(this.connectionData.wsUrl, {
        cookies: this.connectionData.cookies,
      });

      this.websocket.on("connected", () => {
        console.log("WebSocket connected successfully.");
        resolve();
      });

      this.websocket.on("webcastResponse", this._handleWebcastResponse.bind(this));

      this.websocket.on("disconnected", () => {
        this.isConnected = false;
        this.emit(EVENTS.DISCONNECTED);
        // Optional: Implement reconnection logic here if `this.shouldReconnect` is true
      });

      this.websocket.on("error", (error) => {
        console.error("WebSocket connection error:", error);
        reject(error); // Reject the promise on connection error
      });
    });
  }

  /**
   * [Private] Handles incoming messages from the WebSocket and emits corresponding events.
   * @param {Object} response - The decoded response from the WebSocket.
   * @private
   */
  _handleWebcastResponse(response) {
    for (const message of response.messages) {
      if (!message.decodedData) continue;

      const decodedMessage = handleMessageDecoding(message.decodedData);

      switch (message.type) {
        case "WebcastControlMessage":
          // Stream ended by host
          if ([3, 4].includes(message.decodedData.action)) {
            this.shouldReconnect = false;
            this.emit(EVENTS.STREAM_END, { action: message.decodedData.action });
            this.disconnect();
          }
          break;
        case "WebcastRoomUserSeqMessage":
          this.emit(EVENTS.ROOM_USER, decodedMessage);
          break;
        case "WebcastChatMessage":
          this.emit(EVENTS.CHAT, decodedMessage);
          break;
        case "WebcastMemberMessage":
          this.emit(EVENTS.MEMBER, decodedMessage);
          break;
        case "WebcastGiftMessage":
          this.emit(EVENTS.GIFT, decodedMessage);
          break;
        case "WebcastSocialMessage":
          this.emit(EVENTS.SOCIAL, decodedMessage);
          if (decodedMessage.displayType?.includes("follow")) {
            this.emit(EVENTS.FOLLOW, decodedMessage);
          }
          if (decodedMessage.displayType?.includes("share")) {
            this.emit(EVENTS.SHARE, decodedMessage);
          }
          break;
        case "WebcastLikeMessage":
          this.emit(EVENTS.LIKE, decodedMessage);
          break;
        case "WebcastQuestionNewMessage":
          this.emit(EVENTS.QUESTION_NEW, decodedMessage);
          break;
        case "WebcastLinkMicBattle":
          this.emit(EVENTS.LINK_MIC_BATTLE, decodedMessage);
          break;
        case "WebcastLinkMicArmies":
          this.emit(EVENTS.LINK_MIC_ARMIES, decodedMessage);
          break;
        case "WebcastLiveIntroMessage":
          this.emit(EVENTS.LIVE_INTRO, decodedMessage);
          break;
        case "WebcastEmoteChatMessage":
          this.emit(EVENTS.EMOTE, decodedMessage);
          break;
        case "WebcastEnvelopeMessage":
          this.emit(EVENTS.ENVELOPE, decodedMessage);
          break;
        case "WebcastSubNotifyMessage":
          this.emit(EVENTS.SUBSCRIBE, decodedMessage);
          break;
      }
    }
  }
}

module.exports = { TikTokConnection, EVENTS };