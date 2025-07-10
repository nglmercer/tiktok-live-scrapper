const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { deserializeWebsocketMessage } = require('../core/messageDecoder'); // Asumiendo que messageDecoder está en la misma carpeta
const emitter = require('./eventEmitter'); // ¡Importamos nuestro emisor de eventos!
const os = require('os');
const fs = require('fs');
const path = require('path');
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
function getChromeExecutablePath() {
    const platform = os.platform();
    let possiblePaths = [];

    if (platform === 'win32') { // Windows
        const prefixes = [
            process.env.LOCALAPPDATA,
            process.env.PROGRAMFILES,
            process.env['PROGRAMFILES(X86)']
        ];
        prefixes.forEach(prefix => {
            if (prefix) {
                possiblePaths.push(path.join(prefix, 'Google', 'Chrome', 'Application', 'chrome.exe'));
            }
        });
        // También podemos buscar Edge, ya que es basado en Chromium
        possiblePaths.push(path.join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'));

    } else if (platform === 'darwin') { // macOS
        possiblePaths = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ];
    } else { // Linux (y otros)
        possiblePaths = [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium-browser',
            '/usr/bin/chromium',
            '/snap/bin/chromium',
        ];
    }

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            console.log(`[TikTokConnector] Navegador encontrado en: ${p}`);
            return p;
        }
    }

    return null;
}
const executablePath = getChromeExecutablePath();
/**
 * Inicia la intercepción de eventos para un usuario específico y emite los eventos.
 * @param {string} username El nombre de usuario de TikTok.
 */
async function interceptAndEmitEvents(username) {
    const liveUrl = `https://www.tiktok.com/@${username}/live`;
    // DESPUÉS
    const browser = await puppeteer.launch({ 
        headless: 'new',
        executablePath: executablePath // <-- ¡AQUÍ ESTÁ LA MAGIA!
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