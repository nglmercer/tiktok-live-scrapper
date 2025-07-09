// src/server/index.js
const WebSocket = require('ws');
const { RoomManager } = require('./RoomManager');

const PORT = process.env.PORT || 8080;

const wss = new WebSocket.Server({ port: PORT });
const roomManager = new RoomManager();

console.log(`🚀 TikTok LIVE WebSocket API Server is running on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
    console.log('[Server] A new client has connected.');

    ws.on('message', (message) => {
        try {
            const parsedMessage = JSON.parse(message);
            
            if (parsedMessage.action === 'subscribe' && parsedMessage.username) {
                console.log(`[Server] Client requested to subscribe to user: ${parsedMessage.username}`);
                roomManager.subscribe(ws, parsedMessage.username);
            } else {
                ws.send(JSON.stringify({ event: 'error', data: 'Invalid message format. Use {"action": "subscribe", "username": "tiktokuser"}' }));
            }
        } catch (error) {
            console.error('[Server] Failed to parse client message:', error);
            ws.send(JSON.stringify({ event: 'error', data: 'Invalid JSON message.' }));
        }
    });

    ws.on('close', () => {
        console.log('[Server] A client has disconnected.');
        roomManager.unsubscribe(ws);
    });

    ws.on('error', (error) => {
        console.error('[Server] A client WebSocket error occurred:', error);
        roomManager.unsubscribe(ws); // Limpiar en caso de error también
    });
});