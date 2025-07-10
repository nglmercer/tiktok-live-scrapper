const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { deserializeWebsocketMessage } = require('../core/messageDecoder'); // Asumiendo que messageDecoder está en la misma carpeta
const emitter = require('./eventEmitter'); // ¡Importamos nuestro emisor de eventos!

puppeteer.use(StealthPlugin());

// Usamos un Map para llevar un registro de las conexiones activas
const activeConnections = new Map();

/**
 * Procesa la respuesta decodificada para obtener un formato de evento estandarizado.
 * (Tu función getMessage original, ligeramente adaptada para claridad)
 */
function processDecodedResponse(response) {
    if (!response || !response.webcastResponse || !Array.isArray(response.webcastResponse.messages)) {
        return [];
    }

    const eventMap = {
        'WebcastChatMessage': 'chat',
        'WebcastGiftMessage': 'gift',
        'WebcastLikeMessage': 'like',
        'WebcastMemberMessage': 'member',
        'WebcastSocialMessage': 'social',
        'WebcastRoomUserSeqMessage': 'roomUser',
        'WebcastSubNotifyMessage': 'subscribe',
        'WebcastEmoteChatMessage': 'emote'
    };

    return response.webcastResponse.messages
        .filter(message => message && message.decodedData)
        .map(message => ({
            eventName: eventMap[message.type] || message.type,
            data: message.decodedData
        }));
}

/**
 * Inicia la intercepción de eventos para un usuario específico y emite los eventos.
 * @param {string} username El nombre de usuario de TikTok.
 */
async function interceptAndEmitEvents(username) {
    const liveUrl = `https://www.tiktok.com/@${username}/live`;
    const browser = await puppeteer.launch({ 
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
        ],
        executablePath: process.env.CHROME_BIN || undefined // Por si tienes Chrome en una ruta específica
    });
    const page = await browser.newPage();
    
    // Guardamos la instancia del browser para poder cerrarla después
    activeConnections.set(username, browser);
    console.log(`[TikTokConnector] Iniciando conexión para @${username}`);

    const client = await page.target().createCDPSession();
    await client.send('Network.enable');

    client.on('Network.webSocketFrameReceived', async ({ response }) => {
        if (typeof response?.payloadData === 'string') {
            try {
                const messageBuffer = Buffer.from(response.payloadData, 'base64');
                const decodedContainer = await deserializeWebsocketMessage(messageBuffer);
                const events = processDecodedResponse(decodedContainer);

                // ¡AQUÍ ESTÁ LA MAGIA!
                // En lugar de hacer console.log, emitimos cada evento.
                if (events.length > 0) {
                    events.forEach(event => {
                        emitter.emit('tiktok-event', {
                            username: username, // Incluimos el username para saber de quién es el evento
                            event: event // El objeto { eventName, data }
                        });
                    });
                }
            } catch (err) {
                // Ignorar errores de decodificación que son comunes
            }
        }
    });

    try {
        await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log(`[TikTokConnector] Conectado a @${username}. Escuchando eventos...`);
        // El browser se mantendrá abierto hasta que se llame a disconnect.
    } catch (error) {
        console.error(`[TikTokConnector] Error al conectar con @${username}:`, error.message);
        emitter.emit('connection-error', { username, error: error.message });
        await disconnect(username); // Limpiar si falla la conexión
    }
}

/**
 * Inicia una conexión si no existe una ya.
 * @param {string} username 
 */
function connect(username) {
    if (activeConnections.has(username)) {
        console.log(`[TikTokConnector] Ya existe una conexión para @${username}.`);
        return;
    }
    interceptAndEmitEvents(username).catch(err => {
        console.error(`[TikTokConnector] Fallo irrecuperable en el proceso de @${username}:`, err);
    });
}

/**
 * Cierra la conexión y el browser de Puppeteer para un usuario.
 * @param {string} username 
 */
async function disconnect(username) {
    if (activeConnections.has(username)) {
        console.log(`[TikTokConnector] Desconectando de @${username}...`);
        const browser = activeConnections.get(username);
        await browser.close();
        activeConnections.delete(username);
        console.log(`[TikTokConnector] Conexión para @${username} cerrada.`);
    }
}

module.exports = {
    connect,
    disconnect
};