// ConexionTiktok.js

const EventEmitter = require("events");
const SocketIO = require("socket.io-client");
const WebcastWebsocket = require("./webcastWebsocket");
const axios = require("axios");
const { session } = require("electron");

// Importamos nuestro módulo de utilidades
const {
  parseStickerData,
  updateUrlParams,
  handleMessageDecoding,
} = require("./tiktokUtils");

// Constants for events
const EVENTS = {
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  ERROR: "error",
  RAWDATA: "rawData",
  DECODEDDATA: "decodedData",
  STREAMEND: "streamEnd",
  WSCONNECTED: "websocketConnected"
};

// Constants for message types
const MESSAGE_TYPES = {
  CHAT: "chat",
  MEMBER: "member",
  GIFT: "gift",
  ROOMUSER: "roomUser",
  SOCIAL: "social",
  LIKE: "like",
  QUESTIONNEW: "questionNew",
  LINKMICBATTLE: "linkMicBattle",
  LINKMICARMIES: "linkMicArmies",
  LIVEINTRO: "liveIntro",
  EMOTE: "emote",
  ENVELOPE: "envelope",
  SUBSCRIBE: "subscribe"
};

// Constants for social types
const SOCIAL_TYPES = {
  FOLLOW: "follow",
  SHARE: "share"
};

class ConexionTiktok extends EventEmitter {
  constructor(username, browser) {
    super();
    this.username = username;
    this.websocket = null;
    this.shouldReconnect = false;
    this.isConnected = false;
    this.isProcessing = false;
    this.browser = null;
    this.extraData = null;
    this.browserInstance = browser;
    this.stickersArray = [];
    this.cookies = null;
    this.stickersUrl = null;
  }

  async obtenerStickers(callback) {
   
      console.log("sacando stickers");
      const cookieString = this.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
      const response = await axios.get(this.stickersUrl, {
        headers: {
          Cookie: cookieString
        }
      });
      
      parseStickerData(response.data, callback, this.stickersArray);
    
  }

  // Fix for the q function
  updateUrlWithParams(url, params) {
    let [baseUrl, queryString] = url.split("?");
    if (!queryString) return url;
    
    let urlParams = new URLSearchParams(queryString);
    for (let key in params) {
      if (urlParams.has(key)) {
        urlParams.set(key, params[key]);
      }
    }
    
    return `${baseUrl}?${urlParams.toString()}`;
  }

  async connect() {
    if (this.isProcessing) return;
    
    let status = await this.obtenerStatus();
    if (status.status === 4) {
      return { res: "error", texto: "error2" };
    }
      return new Promise(async (resolve, reject) => {
        console.log(`url => https://www.tiktok.com/@${this.username}/live`);
        this.browser = this.browserInstance.crearNavegador(`https://www.tiktok.com/@${this.username}/live`);
        
        this.captureTikTokData().then(async data => {
          let urlParams = { client_enter: "0" };
          data.url = this.updateUrlWithParams(data.url, urlParams);
          this.stickersUrl = data.stickers;
          this.cookies = data.galletas;
          
          this.connectWebSocket(data.url, data.galletas).then(result => {
            result ? resolve({ res: "ok" }) : reject({ res: "error" });
          });
        });
      });
  }

  captureTikTokData = async () => {
    return new Promise(async (resolve, reject) => {
      let websocketUrl = "";
      let cookiesData = "";
      let stickersUrl = "";

      session.defaultSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, async (details, callback) => {
        if (details.url.includes("webcast16-ws-useast1a.tiktok.com")) {
          websocketUrl = details.url;
          let cookies = await session.defaultSession.cookies.get({ url: details.url });
          cookiesData = cookies;

          if (websocketUrl !== "" && stickersUrl !== "" && cookiesData !== "") {
            if (this.browser) this.browser.close();
            resolve({ url: websocketUrl, galletas: cookiesData, stickers: stickersUrl });
          }
        } else if (details.url.includes("get_sub_emote_detail")) {
          stickersUrl = details.url;
          if (websocketUrl !== "" && stickersUrl !== "" && cookiesData !== "") {
            if (this.browser) this.browser.close();
            resolve({ url: websocketUrl, galletas: cookiesData, stickers: stickersUrl });
          }
        }
        
        callback({ cancel: false });
      });
    });
  };

  connectWebSocket = async (url, cookies) => {
    console.log(url);
    
    return new Promise(async (resolve, reject) => {
      const cookieObj = {};
      cookies.forEach(cookie => {
        cookieObj[cookie.name] = cookie.value;
      });

      const cookieJar = {
        getCookieString: () => cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ")
      };

      if (this.websocket !== null) {
        this.websocket.disconnect();
        this.websocket = null;
      }

      this.isProcessing = false;
      this.websocket = new WebcastWebsocket(url, cookies, {}, {}, cookieObj, {});

      this.websocket.on("webcastResponse", response => {
        this.handleWebcastResponse(response);
      });

      this.websocket.on("messageDecodingFailed", error => {
        console.error("Error al decodificar el mensaje:", error);
        reject({ res: "error", texto: error.toString() });
      });

      this.websocket.on("conectado", () => {
        console.log("WebSocket conectado");
        this.isConnected = true;
        resolve({ res: "ok" });
      });

      this.websocket.on("error", error => {
        console.error("WebSocket error:", error);
        reject({ 
          res: "error", 
          texto: error.toString(), 
          evento: "error_wss" 
        });
      });

      this.websocket.on("disconnected", () => {
        this.shouldReconnect = true;
        console.log("desconectado");
        console.log("this.reconectar", this.shouldReconnect);
        this.emit("disconnected", {});
      });
    });
  };

  async obtenerStatus() {
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.63 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        Connection: "keep-alive"
      }
    };

    const response = await axios.get(
      `https://www.tiktok.com/api-live/user/room/?aid=1988&sourceType=54&uniqueId=${this.username}`,
      options
    );

    let status = response?.data?.data?.user?.status;
    let roomId = response?.data?.data?.user?.roomId;

    return { status, roomId };
  }

  async obtenerRegalos() {
    let statusData = await this.obtenerStatus();
    
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/93.0.4577.63 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        Connection: "keep-alive"
      }
    };

    if (statusData.roomId !== undefined) {
      let url = `https://webcast.tiktok.com/webcast/gift/list/?aid=1988&app_language=en-US&app_name=tiktok_web&browser_language=en&browser_name=Mozilla&browser_online=true&browser_platform=Win32&Mozilla%2F5.0%20%28Windows%20NT%2010.0%3B%20Win64%3B%20x64%3B%20rv%3A128.0%29%20Gecko%2F20100101%20Firefox%2F128.0&cookie_enabled=true&cursor=&internal_ext=&device_platform=web&focus_state=true&from_page=user&history_len=0&is_fullscreen=false&is_page_visible=true&did_rule=3&fetch_rule=1&last_rtt=0&live_id=12&resp_content_type=protobuf&screen_height=1152&screen_width=2048&tz_name=Europe%2FBerlin&referer=https%3A%2F%2Fwww.tiktok.com%2F&root_referer=https%3A%2F%2Fwww.tiktok.com%2F&host=https%3A%2F%2Fwebcast.tiktok.com&version_code=270000&webcast_sdk_version=1.3.0&update_version_code=1.3.0&room_id=${statusData.roomId}`;
      
      const response = await axios.get(url, options);

      try {
        const gifts = [
          ...response?.data?.data?.pages[0]?.gifts || [],
          ...response?.data?.data?.pages[1]?.gifts || [],
          ...response?.data?.data?.gifts
        ];

        return Array.from(new Set(gifts.map(gift => gift.id)))
          .map(id => gifts.find(gift => gift.id === id));
      } catch (error) {
        console.log("error", error);
        return false;
      }
    }

    return false;
  }

  disconnect() {
    this.websocket.disconnect();
  }

  streamend() {
    this.websocket.disconnect();
    this.emit("streamEnd", {});
  }

  handleWebcastResponse = response => {
    response.messages
      .filter(message => message.decodedData)
      .forEach(message => {
        let decodedMessage = handleMessageDecoding(message.decodedData);

        switch (message.type) {
          case "WebcastControlMessage":
            const action = message.decodedData.action;
            if ([3, 4].includes(action)) {
              this.shouldReconnect = false;
              this.emit(EVENTS.STREAMEND, { action });
              this.streamend();
            }
            break;
          case "WebcastRoomUserSeqMessage":
            this.emit(MESSAGE_TYPES.ROOMUSER, decodedMessage);
            break;
          case "WebcastChatMessage":
            this.emit(MESSAGE_TYPES.CHAT, decodedMessage);
            break;
          case "WebcastMemberMessage":
            this.emit(MESSAGE_TYPES.MEMBER, decodedMessage);
            break;
          case "WebcastGiftMessage":
            this.emit(MESSAGE_TYPES.GIFT, decodedMessage);
            break;
          case "WebcastSocialMessage":
            this.emit(MESSAGE_TYPES.SOCIAL, decodedMessage);
            
            if (decodedMessage.displayType?.includes("follow")) {
              this.emit(SOCIAL_TYPES.FOLLOW, decodedMessage);
            }
            
            if (decodedMessage.displayType?.includes("share")) {
              this.emit(SOCIAL_TYPES.SHARE, decodedMessage);
            }
            break;
          case "WebcastLikeMessage":
            this.emit(MESSAGE_TYPES.LIKE, decodedMessage);
            break;
          case "WebcastQuestionNewMessage":
            this.emit(MESSAGE_TYPES.QUESTIONNEW, decodedMessage);
            break;
          case "WebcastLinkMicBattle":
            this.emit(MESSAGE_TYPES.LINKMICBATTLE, decodedMessage);
            break;
          case "WebcastLinkMicArmies":
            this.emit(MESSAGE_TYPES.LINKMICARMIES, decodedMessage);
            break;
          case "WebcastLiveIntroMessage":
            this.emit(MESSAGE_TYPES.LIVEINTRO, decodedMessage);
            break;
          case "WebcastEmoteChatMessage":
            this.emit(MESSAGE_TYPES.EMOTE, decodedMessage);
            break;
          case "WebcastEnvelopeMessage":
            this.emit(MESSAGE_TYPES.ENVELOPE, decodedMessage);
            break;
          case "WebcastSubNotifyMessage":
            this.emit(MESSAGE_TYPES.SUBSCRIBE, decodedMessage);
            break;
        }
      });
  };
}

module.exports = ConexionTiktok;