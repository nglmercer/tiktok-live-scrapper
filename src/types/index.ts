// src/types/index.ts
export interface TikTokEvent {
  eventName: string;
  data: any;
}

export interface TikTokConnectorEvent {
  username: string;
  event: TikTokEvent;
}

export interface ConnectionErrorEvent {
  username: string;
  error: string;
}

export type WebSocketMessage =
  | { action: 'subscribe'; username: string }
  | { action: string; [k: string]: any };