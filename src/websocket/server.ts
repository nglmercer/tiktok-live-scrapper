// src/websocket/server.ts
import http from 'http';
import WebSocket from 'ws';
import { RoomManager } from './RoomManager';
import { connect, disconnect } from '../services/TikTokConnector';
import { emitter } from '../services/eventEmitter';
import type { WebSocketMessage } from '../types';

const server = http.createServer((req, res) => {
  // Respuesta básica para verificar que el servidor está vivo
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('TikTok LIVE WebSocket Server corriendo - Conéctate vía WebSocket');
});

const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 8080;

const roomManager = new RoomManager();

console.log(`TikTok LIVE WebSocket API corriendo en ws://localhost:${PORT}`);

emitter.onTikTokEvent(({ username, event }) => {
  roomManager.broadcast(username, event);
});

emitter.onConnectionError(({ username, error }) => {
  roomManager.broadcast(username, {
    eventName: 'error',
    data: `No se pudo conectar al LIVE de @${username}: ${error}`,
  });
});

wss.on('connection', (ws: WebSocket) => {
  console.log('[Server] Nuevo cliente conectado');

  ws.on('message', (data: WebSocket.RawData) => {
    try {
      const msg: WebSocketMessage = JSON.parse(data.toString());

      if (msg.action === 'subscribe' && typeof msg.username === 'string') {
        const username = msg.username.trim().toLowerCase();

        if (!username) {
          ws.send(JSON.stringify({
            event: 'error',
            data: 'El username no puede estar vacío',
          }));
          return;
        }

        const isFirst = roomManager.subscribe(ws, username);

        if (isFirst) {
          console.log(`[Server] Primer suscriptor → conectando a @${username}`);
          connect(username);
        }

        ws.send(JSON.stringify({
          event: 'subscribed',
          data: `Suscrito correctamente a @${username}`,
        }));
      } else {
        ws.send(JSON.stringify({
          event: 'error',
          data: 'Acción no válida. Usa: {"action": "subscribe", "username": "tiktokuser"}',
        }));
      }
    } catch (err) {
      ws.send(JSON.stringify({
        event: 'error',
        data: 'Mensaje JSON inválido',
      }));
    }
  });

  ws.on('close', () => {
    console.log('[Server] Cliente desconectado');
    const emptiedRoom = roomManager.unsubscribe(ws);
    if (emptiedRoom) {
      console.log(`[Server] Sala vacía → desconectando @${emptiedRoom}`);
      disconnect(emptiedRoom);
    }
  });

  ws.on('error', (error) => {
    console.error('[Server] Error en conexión WebSocket:', error);
    const emptiedRoom = roomManager.unsubscribe(ws);
    if (emptiedRoom) disconnect(emptiedRoom);
  });
});

// Manejo graceful shutdown
process.on('SIGTERM', () => {
  console.log('\nCerrando servidor...');
  wss.close(() => {
    console.log('Todos los WebSockets cerrados');
    server.close(() => {
      console.log('Servidor HTTP cerrado');
      process.exit(0);
    });
  });
});

server.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
  console.log(`WebSocket listo en ws://localhost:${PORT}`);
});