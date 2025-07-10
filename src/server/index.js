const http = require('http');
const WebSocket = require('ws');
const nodeStatic = require('node-static');
const path = require('path');
const { RoomManager } = require('./RoomManager');
const tikTokConnector = require('../services/TikTokConnector'); // Importamos el conector
const emitter = require('../services/eventEmitter'); // Importamos el emisor/escuchador
const fileServer = new nodeStatic.Server(path.join(process.cwd(), './public'));

const server = http.createServer((req, res) => {
  fileServer.serve(req, res);
});

const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 8080;

const roomManager = new RoomManager();

console.log(`🚀 TikTok LIVE WebSocket API Server is running on ws://localhost:${PORT}`);

// =======================================================
//          ESCUCHADOR DE EVENTOS DE TIKTOK
// =======================================================
// Aquí es donde el servidor "escucha" los eventos que el conector emite.
emitter.on('tiktok-event', ({ username, event }) => {
    // Cuando llega un evento, lo retransmitimos a la sala correcta.
    // 'event' ya tiene el formato { eventName, data }
    // console.log(`[Emitter] Evento '${event.eventName}' recibido para @${username}`);
    roomManager.broadcast(username, event);
});

emitter.on('connection-error', ({ username, error }) => {
    console.log(`[Emitter] Error de conexión para @${username}. Notificando a los clientes.`);
    roomManager.broadcast(username, { 
        eventName: 'error', 
        data: `Failed to connect to TikTok LIVE for user @${username}: ${error}`
    });
});


// =======================================================
//          LÓGICA DEL SERVIDOR WEBSOCKET
// =======================================================
wss.on('connection', (ws) => {
    console.log('[Server] Un nuevo cliente se ha conectado.');

    ws.on('message', (message) => {
        try {
            const parsedMessage = JSON.parse(message);
            
            if (parsedMessage.action === 'subscribe' && parsedMessage.username) {
                const username = parsedMessage.username.toLowerCase();
                console.log(`[Server] Cliente solicitó suscripción para: @${username}`);
                
                // Suscribimos al cliente a la sala.
                // El método devuelve `true` si es el primer cliente en esa sala.
                const isFirstSubscriber = roomManager.subscribe(ws, username);

                if (isFirstSubscriber) {
                    console.log(`[Server] Primer suscriptor para @${username}. Iniciando conector de TikTok...`);
                    // Si es el primero, le pedimos al conector que empiece a escuchar.
                    tikTokConnector.connect(username);
                }

                ws.send(JSON.stringify({ event: 'subscribed', data: `Successfully subscribed to @${username}`}));

            } else {
                ws.send(JSON.stringify({ event: 'error', data: 'Invalid message format. Use {"action": "subscribe", "username": "tiktokuser"}' }));
            }
        } catch (error) {
            console.error('[Server] Error al procesar el mensaje del cliente:', error);
            ws.send(JSON.stringify({ event: 'error', data: 'Invalid JSON message.' }));
        }
    });

    ws.on('close', () => {
        console.log('[Server] Un cliente se ha desconectado.');
        // Cuando un cliente se va, lo desuscribimos.
        // El método devuelve el nombre de la sala si esta quedó vacía.
        const emptiedRoom = roomManager.unsubscribe(ws);
        
        if (emptiedRoom) {
            console.log(`[Server] La sala para @${emptiedRoom} está vacía. Desconectando el conector de TikTok...`);
            // Si la sala quedó vacía, cerramos la conexión;
            tikTokConnector.disconnect(emptiedRoom);
        }
    });

    ws.on('error', (error) => {
        console.error('[Server] Error en el WebSocket de un cliente:', error);
        // También limpiamos en caso de error.
        const emptiedRoom = roomManager.unsubscribe(ws);
        if (emptiedRoom) {
            tikTokConnector.disconnect(emptiedRoom);
        }
    });
});
server.listen(PORT);