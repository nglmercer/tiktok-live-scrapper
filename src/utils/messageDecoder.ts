// src/utils/messageDecoder.ts
import protobuf from 'protobufjs';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';

const unzip = promisify(zlib.unzip);

const PROTO_MESSAGE_TYPES = {
  CONTROL: 'WebcastControlMessage',
  CHAT: 'WebcastChatMessage',
  GIFT: 'WebcastGiftMessage',
  LIKE: 'WebcastLikeMessage',
  MEMBER: 'WebcastMemberMessage',
  SOCIAL: 'WebcastSocialMessage',
  ROOM_USER_SEQ: 'WebcastRoomUserSeqMessage',
  SUB_NOTIFY: 'WebcastSubNotifyMessage',
  EMOTE_CHAT: 'WebcastEmoteChatMessage',
} as const;

class TikTokSchemaManager {
  private static instance: TikTokSchemaManager;
  private schema: protobuf.Root;

  private constructor() {
    const schemaPath = require.resolve('./tiktokSchema.proto');
    this.schema = protobuf.loadSync(schemaPath);
  }

  static getInstance(): TikTokSchemaManager {
    if (!TikTokSchemaManager.instance) {
      TikTokSchemaManager.instance = new TikTokSchemaManager();
    }
    return TikTokSchemaManager.instance;
  }

  getSchema(): protobuf.Root {
    return this.schema;
  }
}

const schemaManager = TikTokSchemaManager.getInstance();

function deserializeMessage(protoName: string, binaryMessage: Buffer): any {
  const schema = schemaManager.getSchema();
  const type = schema.lookupType(`TikTok.${protoName}`);
  const decoded = type.decode(binaryMessage);

  if (protoName === 'WebcastResponse' && Array.isArray((decoded as any).messages)) {
    (decoded as any).messages.forEach((message: any) => {
      const messageType = message.type;
      if (Object.values(PROTO_MESSAGE_TYPES).includes(messageType)) {
        try {
          message.decodedData = schema.lookupType(`TikTok.${messageType}`).decode(message.binary);
        } catch (err) {
          console.warn(`Error decodificando mensaje anidado ${messageType}:`, (err as Error).message);
        }
      }
    });
  }

  return decoded;
}

export async function deserializeWebsocketMessage(binaryMessage: Buffer): Promise<any> {
  const wsMessage = deserializeMessage('WebcastWebsocketMessage', binaryMessage);

  if (wsMessage.type === 'msg' && wsMessage.binary) {
    let binary = wsMessage.binary;

    // Detectar y descomprimir gzip
    if (binary.length > 2 && binary[0] === 0x1f && binary[1] === 0x8b) {
      binary = await unzip(binary);
    }

    wsMessage.webcastResponse = deserializeMessage('WebcastResponse', binary);
  }

  return wsMessage;
}

export function serializeMessage(protoName: string, obj: any): Buffer {
  const schema = schemaManager.getSchema();
  const uint8Array = schema.lookupType(`TikTok.${protoName}`).encode(obj).finish();
  
  // Convertir Uint8Array → Buffer de forma segura
  return Buffer.from(uint8Array);
}