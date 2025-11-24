// src/websocket/RoomManager.ts
import type WebSocket from 'ws';
import type { TikTokEvent } from '../types';

export class RoomManager {
  private rooms = new Map<string, Set<WebSocket>>();
  private clientRooms = new Map<WebSocket, string>();

  subscribe(ws: WebSocket, username: string): boolean {
    this.unsubscribe(ws);

    if (!this.rooms.has(username)) {
      this.rooms.set(username, new Set());
    }

    const room = this.rooms.get(username)!;
    room.add(ws);
    this.clientRooms.set(ws, username);

    console.log(`[RoomManager] Cliente suscrito a @${username}. Total: ${room.size}`);
    return room.size === 1;
  }

  unsubscribe(ws: WebSocket): string | null {
    const username = this.clientRooms.get(ws);
    if (!username) return null;

    const room = this.rooms.get(username);
    if (room) {
      room.delete(ws);
      if (room.size === 0) {
        this.rooms.delete(username);
        console.log(`[RoomManager] Sala @${username} vacía y eliminada`);
        this.clientRooms.delete(ws);
        return username;
      }
    }

    this.clientRooms.delete(ws);
    return null;
  }

  broadcast(username: string, payload: TikTokEvent): void {
    const room = this.rooms.get(username);
    if (!room) return;

    const message = JSON.stringify({
      event: payload.eventName,
      data: payload.data,
    });

    room.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    });
  }
}