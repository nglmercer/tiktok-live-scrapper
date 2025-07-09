const { deserializeWebsocketMessage, serializeMessage } = require('./messageDecoder');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

async function interceptWithPuppeteerCDP(username) {
    const liveUrl = `https://www.tiktok.com/@${username}/live`;
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    // 1. Crear una sesión con el Chrome DevTools Protocol
    const client = await page.target().createCDPSession();

    // 2. Habilitar la intercepción de red
    await client.send('Network.enable');

    // 3. Escuchar los eventos de tramas WebSocket recibidas
    client.on('Network.webSocketFrameReceived',async ({ requestId, timestamp, response }) => {
        console.log('--- Trama Recibida (del servidor) ---');
        // El payload puede estar en base64, necesitas decodificarlo.
        const payloadData = response?.payloadData;
        if (typeof payloadData === 'string') {
            // Convierte el string Base64 a un Buffer
            const messageBuffer = Buffer.from(payloadData, 'base64');
            
            // Ahora puedes pasar este buffer a tu decodificador
            const decodedContainer = await deserializeWebsocketMessage(messageBuffer);
            console.log('Payload decodificado:',getMessage(decodedContainer));
        }
        // Aquí, igual que con Playwright, necesitarás decodificar el Protobuf.
    });
    
    // Opcional: escuchar tramas enviadas
    client.on('Network.webSocketFrameSent', async ({ requestId, timestamp, request }) => {
         console.log('--- Trama Enviada (desde el cliente) ---');
         const payloadData = request?.payloadData;
            if (typeof payloadData === 'string') {
                // Convierte el string Base64 a un Buffer
                const messageBuffer = Buffer.from(payloadData, 'base64');
                
                // Ahora puedes pasar este buffer a tu decodificador
                const decodedContainer = await deserializeWebsocketMessage(messageBuffer);
                console.log('Payload decodificado:',getMessage(decodedContainer));
            }
    });

    console.log(`[${username}] Navegando a ${liveUrl}...`);
    try {
        await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        console.log(`[${username}] Página cargada. Escuchando eventos del CDP...`);
        await new Promise(resolve => setTimeout(resolve, 300000));
    } catch (error) {
        console.error(`[${username}] Error:`, error.message);
    } finally {
        await browser.close();
    }
}
function sendAck(decodedContainer){
    if (!decodedContainer || !decodedContainer.id) {
        console.error('No se pudo enviar ACK: Contenedor decodificado inválido o sin ID.');
        return;
    }
    const { id } = decodedContainer;
    // Usamos la función importada para serializar (codificar)
    const ackMsg = serializeMessage('WebcastWebsocketAck', {
    type: 'ack',
    id
    });
    return ackMsg;
}
/**
 * Procesa una respuesta del decodificador de WebSocket para extraer,
 * filtrar y transformar los mensajes en un formato de evento estandarizado.
 *
 * @param {object} response El objeto de respuesta decodificado que contiene webcastResponse.messages.
 * @returns {Array<object>} Un array de objetos de evento, donde cada objeto tiene `eventName` y `processedData`. Devuelve un array vacío si no hay mensajes válidos.
 */
function getMessage(response) {
    // 1. BUENA PRÁCTICA: Comprobación de seguridad.
    // Se mantiene tu comprobación inicial, pero se devuelve un array vacío para consistencia.
    if (!response || !response.webcastResponse || !Array.isArray(response.webcastResponse.messages)) {
        // console.error('Respuesta inválida o sin mensajes para procesar.');
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

    // 2. LA CORRECCIÓN PRINCIPAL: Usar filter() y map() en lugar de forEach()
    const processedMessages = response.webcastResponse.messages
        // Primero, filtramos para quedarnos solo con los mensajes que nos interesan
        .filter(message => message && message.decodedData)
        // Luego, transformamos (mapeamos) cada mensaje válido a nuestro formato de evento
        .map(message => {
            // Usamos el mapa para obtener el nombre amigable, o el tipo original si no está en el mapa.
            const eventName = eventMap[message.type] || message.type;
            
            return {
                eventName,
                processedData: message.decodedData
            };
        });

    // 3. Devolvemos el array resultante que ahora sí contiene los datos.
    return processedMessages;
}
interceptWithPuppeteerCDP('joselitacr'); // Reemplaza con un usuario en vivo