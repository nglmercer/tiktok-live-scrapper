import { Buffer } from 'node:buffer';
import { deserializeWebsocketMessage, serializeMessage } from '../utils/messageDecoder';

export interface DecodeRequest {
  base64?: string;
  buffer?: number[];
}

export interface EncodeRequest {
  protoName: string;
  data: any;
}

export interface ServiceResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export class ProtobufService {
  static async decode(input: DecodeRequest): Promise<ServiceResponse<any>> {
    try {
      let binaryData: Buffer;

      if (input.base64) {
        binaryData = Buffer.from(input.base64, 'base64');
      } else if (input.buffer) {
        binaryData = Buffer.from(new Uint8Array(input.buffer));
      } else {
        return {
          success: false,
          error: 'Missing "base64" or "buffer" in request'
        };
      }

      const decodedMessage = await deserializeWebsocketMessage(binaryData);

      return {
        success: true,
        data: decodedMessage
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error decoding message'
      };
    }
  }

  static async encode(protoName: string, data: any): Promise<ServiceResponse<{ base64: string; buffer: number[] }>> {
    try {
      const encodedBuffer = serializeMessage(protoName, data);

      return {
        success: true,
        data: {
          base64: encodedBuffer.toString('base64'),
          buffer: Array.from(encodedBuffer)
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error encoding message'
      };
    }
  }

  static isBase64(str: string): boolean {
    try {
      return Buffer.from(str, 'base64').toString('base64') === str;
    } catch (err) {
      return false;
    }
  }
}
