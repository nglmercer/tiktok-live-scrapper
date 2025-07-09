// messageDecoder.js
const protobufjs = require('protobufjs');
const util = require('node:util');
const zlib = require('node:zlib');

// Promisify zlib.unzip para poder usar async/await
const unzip = util.promisify(zlib.unzip);

// Constantes específicas de los tipos de mensajes Protobuf
const PROTO_MESSAGE_TYPES = {
  CONTROL: 'WebcastControlMessage',
  ROOM_USER_SEQ: 'WebcastRoomUserSeqMessage',
  CHAT: 'WebcastChatMessage',
  MEMBER: 'WebcastMemberMessage',
  GIFT: 'WebcastGiftMessage',
  SOCIAL: 'WebcastSocialMessage',
  LIKE: 'WebcastLikeMessage',
  QUESTION: 'WebcastQuestionNewMessage',
  LINK_MIC_BATTLE: 'WebcastLinkMicBattle',
  LINK_MIC_ARMIES: 'WebcastLinkMicArmies',
  LIVE_INTRO: 'WebcastLiveIntroMessage',
  EMOTE_CHAT: 'WebcastEmoteChatMessage',
  ENVELOPE: 'WebcastEnvelopeMessage',
  SUB_NOTIFY: 'WebcastSubNotifyMessage'
};

// Configuración global para el decodificador
const config = {
  // Puedes añadir aquí tipos de mensajes a ignorar para mejorar el rendimiento
  skipMessageTypes: [] 
};

/**
 * Singleton para gestionar el esquema de Protobuf de TikTok.
 * Se asegura de que el archivo .proto se cargue una sola vez.
 */
class TikTokSchemaManager {
  constructor() {
    if (TikTokSchemaManager.instance) {
      return TikTokSchemaManager.instance;
    }
    // Asegúrate de que la ruta al archivo .proto sea correcta
    this.schemaPath = require.resolve('./tiktokSchema.proto'); 
    this.schema = protobufjs.loadSync(this.schemaPath);
    TikTokSchemaManager.instance = this;
  }

  getSchema() {
    return this.schema;
  }
}

const schemaManager = new TikTokSchemaManager();

/**
 * Deserializa un mensaje Protobuf a un objeto JavaScript.
 * @param {string} protoName El nombre del tipo de mensaje en el archivo .proto.
 * @param {Buffer} binaryMessage El buffer binario a decodificar.
 * @returns {object} El objeto JavaScript decodificado.
 */
function deserializeMessage(protoName, binaryMessage) {
  const schema = schemaManager.getSchema();
  const webcastData = schema.lookupType(`TikTok.${protoName}`).decode(binaryMessage);

  // Si es una WebcastResponse, decodifica los mensajes anidados
  if (protoName === 'WebcastResponse' && Array.isArray(webcastData.messages)) {
    webcastData.messages.forEach(message => {
      if (config.skipMessageTypes.includes(message.type)) return;
      
      const messageType = message.type;
      if (Object.values(PROTO_MESSAGE_TYPES).includes(messageType)) {
        try {
          message.decodedData = schema.lookupType(`TikTok.${messageType}`).decode(message.binary);
        } catch (err) {
          console.warn(`Error al decodificar el mensaje anidado de tipo "${messageType}":`, err.message);
        }
      }
    });
  }

  return webcastData;
}

/**
 * Deserializa el contenedor principal de un mensaje de WebSocket.
 * Maneja la descompresión Gzip si es necesario.
 * @param {Buffer} binaryMessage El buffer binario recibido del WebSocket.
 * @returns {Promise<object>} Una promesa que resuelve con el objeto decodificado.
 */
async function deserializeWebsocketMessage(binaryMessage) {
  const decodedWebsocketMessage = deserializeMessage('WebcastWebsocketMessage', binaryMessage);
  
  if (decodedWebsocketMessage.type === 'msg') {
    let binary = decodedWebsocketMessage.binary;
    
    // Verifica la firma mágica de Gzip (0x1f 0x8b 0x08) y descomprime
    if (binary && binary.length > 2 && binary[0] === 0x1f && binary[1] === 0x8b && binary[2] === 0x08) {
      decodedWebsocketMessage.binary = await unzip(binary);
    }
    
    decodedWebsocketMessage.webcastResponse = deserializeMessage('WebcastResponse', decodedWebsocketMessage.binary);
  }
  
  return decodedWebsocketMessage;
}

/**
 * Serializa un objeto JavaScript a un mensaje Protobuf binario.
 * @param {string} protoName El nombre del tipo de mensaje en el archivo .proto.
 * @param {object} obj El objeto JavaScript a codificar.
 * @returns {Buffer} El buffer binario codificado.
 */
function serializeMessage(protoName, obj) {
  const schema = schemaManager.getSchema();
  return schema.lookupType(`TikTok.${protoName}`).encode(obj).finish();
}

// Exportamos las funciones que serán utilizadas por otros módulos
module.exports = {
  deserializeWebsocketMessage,
  serializeMessage
};