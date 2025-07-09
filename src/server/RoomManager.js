// src/server/RoomManager.js
const { TikTokConnector } = require('../core/TikTokConnector');

class RoomManager {
    constructor() {
        // Almacena las instancias de TikTokConnector por nombre de usuario
        this.connectors = new Map();
        // Almacena los clientes (WebSockets) suscritos a cada sala/usuario
        this.subscriptions = new Map();
    }

    /**
     * Suscribe un cliente a una sala de TikTok.
     * @param {WebSocket} clientWs - El socket del cliente que se suscribe.
     * @param {string} username - El nombre de usuario de TikTok al que suscribirse.
     */
    subscribe(clientWs, username) {
        username = username.toLowerCase();
        
        // Añadir cliente a la lista de suscripciones de la sala
        if (!this.subscriptions.has(username)) {
            this.subscriptions.set(username, new Set());
        }
        this.subscriptions.get(username).add(clientWs);

        // Si no hay un conector para este usuario, crear uno
        if (!this.connectors.has(username)) {
            console.log(`[Server] No active connector for '${username}'. Creating a new one.`);
            const connector = new TikTokConnector();
            this.connectors.set(username, connector);

            // Escuchar todos los eventos del conector y retransmitirlos
            const eventsToBroadcast = ['chat', 'gift', 'like', 'member', 'social', 'roomUser', 'subscribe', 'emote', 'streamEnd'];
            
            // Eventos de estado para informar a los clientes
            connector.on('connected', (data) => this.broadcast(username, 'status:connected', data));
            connector.on('disconnected', (data) => this.broadcast(username, 'status:disconnected', data));
            connector.on('error', (data) => this.broadcast(username, 'status:error', data));

            // Eventos de datos
            eventsToBroadcast.forEach(eventName => {
                connector.on(eventName, (data) => {
                    this.broadcast(username, eventName, data);
                });
            });
            
            connector.connect(username);
        }
    }

    /**
     * Desuscribe un cliente de todas las salas a las que estaba suscrito.
     * @param {WebSocket} clientWs - El socket del cliente que se desconecta.
     */
    unsubscribe(clientWs) {
        this.subscriptions.forEach((subscribers, username) => {
            if (subscribers.has(clientWs)) {
                subscribers.delete(clientWs);
                console.log(`[Server] Client unsubscribed from '${username}'.`);

                // Si la sala se queda vacía, desconectar y limpiar el conector
                if (subscribers.size === 0) {
                    console.log(`[Server] Room '${username}' is now empty. Disconnecting...`);
                    const connector = this.connectors.get(username);
                    if (connector) {
                        connector.disconnect();
                        this.connectors.delete(username);
                    }
                    this.subscriptions.delete(username);
                }
            }
        });
    }

    /**
     * Envía un mensaje a todos los clientes suscritos a una sala.
     * @param {string} username - La sala a la que se enviará el mensaje.
     * @param {string} event - El nombre del evento.
     * @param {object} data - Los datos del evento.
     */
    broadcast(username, event, data) {
        const subscribers = this.subscriptions.get(username);
        if (!subscribers) return;

        const message = JSON.stringify({ event, data });

        subscribers.forEach(client => {
            if (client.readyState === 1) { // WebSocket.OPEN
                client.send(message);
            }
        });
    }
}

module.exports = { RoomManager };