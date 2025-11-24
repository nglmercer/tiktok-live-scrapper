// src/services/eventEmitter.ts
import { EventEmitter } from 'events';
import type { TikTokConnectorEvent, ConnectionErrorEvent } from '../types';

class TikTokEventEmitter extends EventEmitter {
  emitTikTokEvent(event: TikTokConnectorEvent) {
    this.emit('tiktok-event', event);
  }

  emitConnectionError(event: ConnectionErrorEvent) {
    this.emit('connection-error', event);
  }

  onTikTokEvent(callback: (event: TikTokConnectorEvent) => void) {
    this.on('tiktok-event', callback);
  }

  onConnectionError(callback: (event: ConnectionErrorEvent) => void) {
    this.on('connection-error', callback);
  }
}

// Singleton
export const emitter = new TikTokEventEmitter();