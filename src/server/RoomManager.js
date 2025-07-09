class RoomManager {
    constructor() {
        // Almacena las salas: Map<username, Set<WebSocket>>
        this.rooms = new Map();
        // Almacenamiento inverso para encontrar la sala de un cliente: Map<WebSocket, username>
        this.clientRooms = new Map();
    }

    /**
     * Suscribe un cliente a una sala (username).
     * @param {WebSocket} ws El cliente WebSocket.
     * @param {string} username El nombre de la sala (usuario de TikTok).
     * @returns {boolean} Devuelve `true` si era el primer cliente en la sala, `false` si no.
     */
    subscribe(ws, username) {
        // Si el cliente ya está en otra sala, lo quitamos primero
        this.unsubscribe(ws);

        if (!this.rooms.has(username)) {
            this.rooms.set(username, new Set());
        }

        const room = this.rooms.get(username);
        room.add(ws);
        this.clientRooms.set(ws, username);

        console.log(`[RoomManager] Cliente suscrito a la sala '${username}'. Clientes totales en la sala: ${room.size}`);
        return room.size === 1; // Devuelve true si es el primer suscriptor
    }

    /**
     * Desuscribe a un cliente de su sala actual.
     * @param {WebSocket} ws El cliente WebSocket.
     * @returns {string|null} Devuelve el nombre de la sala si esta quedó vacía, si no null.
     */
    unsubscribe(ws) {
        const username = this.clientRooms.get(ws);
        if (!username) {
            return null;
        }

        const room = this.rooms.get(username);
        if (room) {
            room.delete(ws);
            console.log(`[RoomManager] Cliente desuscrito de la sala '${username}'. Clientes restantes: ${room.size}`);
            
            // Si la sala queda vacía, la eliminamos
            if (room.size === 0) {
                this.rooms.delete(username);
                console.log(`[RoomManager] La sala '${username}' está vacía y ha sido eliminada.`);
                this.clientRooms.delete(ws);
                return username; // Informamos que la sala quedó vacía
            }
        }

        this.clientRooms.delete(ws);
        return null;
    }

    /**
     * Envía un mensaje a todos los clientes de una sala.
     * @param {string} username El nombre de la sala.
     * @param {object} payload El objeto a enviar (con formato { eventName, data }).
     */
    broadcast(username, payload) {
        const room = this.rooms.get(username);
        if (!room) {
            return;
        }

        // Formateamos el mensaje final para el cliente
        const message = JSON.stringify({
            event: payload.eventName,
            data: payload.data
        });

        room.forEach(client => {
            if (client.readyState === client.OPEN) {
                client.send(message);
            }
        });
    }
}

module.exports = { RoomManager };