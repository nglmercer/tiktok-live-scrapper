import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { deserializeWebsocketMessage } from '../utils/messageDecoder';
import { emitter } from './eventEmitter';
import type { TikTokEvent } from '../types';

// === CORRECCIÓN 1: Configuración Única de Plugins ===
// No uses puppeteer.use(StealthPlugin()) y luego otra vez manual. Hazlo solo una vez.
const stealth = StealthPlugin();
stealth.enabledEvasions.delete('user-agent-override'); // Desactivar para usar nuestro UA manual
puppeteer.use(stealth);

const activeConnections = new Map<string, any>(); // Usar 'any' o el tipo Browser correcto

function processDecodedResponse(response: any): TikTokEvent[] {
  if (!response?.webcastResponse?.messages?.length) return [];

  const eventMap: Record<string, string> = {
    WebcastChatMessage: 'chat',
    WebcastGiftMessage: 'gift',
    WebcastLikeMessage: 'like',
    WebcastMemberMessage: 'member',
    WebcastSocialMessage: 'social',
    WebcastRoomUserSeqMessage: 'roomUser',
    WebcastSubNotifyMessage: 'subscribe',
    WebcastEmoteChatMessage: 'emote',
  };

  return response.webcastResponse.messages
    .filter((m: any) => m?.decodedData)
    .map((m: any) => ({
      eventName: eventMap[m.type] || m.type,
      data: m.decodedData,
    }));
}

const puppeteer_config = {
  headless: false,
};

async function interceptAndEmitEvents(username: string): Promise<void> {
  const liveUrl = `https://www.tiktok.com/@${username}/live`;
  let browser;

  try {
    browser = await puppeteer.launch(puppeteer_config);
    activeConnections.set(username, browser);
    
    const page = await browser.newPage();

    // === UA Fijo y Headers ===
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    await page.setUserAgent(userAgent);

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    });

    console.log(`[TikTokConnector] Iniciando conexión para @${username}...`);

    // Configurar CDP antes de navegar
    const client = await page.createCDPSession();
    await client.send('Network.enable');

    client.on('Network.webSocketFrameReceived', async ({ response }) => {
      // Manejo de errores dentro del callback para no romper el proceso
      try {
        if (!response?.payloadData || typeof response.payloadData !== 'string') return;
        if (response.payloadData.length < 50) return; 

        const buffer = Buffer.from(response.payloadData, 'base64');
        const decoded = await deserializeWebsocketMessage(buffer);
        
        if (!decoded?.webcastResponse?.messages?.length) return;

        const events = processDecodedResponse(decoded);
        if (events.length === 0) return;

        events.forEach((event) => {
          emitter.emitTikTokEvent({ username, event });
        });
      } catch (err) {
        // Silenciar errores de decodificación o frames vacíos
      }
    });

    // === CORRECCIÓN 2: Estrategia de Navegación ===
    // Usar 'domcontentloaded' en lugar de 'networkidle2'.
    // En un live stream, la red nunca está idle.
    await page.goto(liveUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });

    // Opcional: Esperar un poco más para asegurar que el JS de TikTok cargue
    // sin depender de la red inactiva.
    try {
        // Intentar cerrar modal de login si aparece (selector genérico, puede variar)
        await page.waitForSelector('body', { timeout: 5000 });
    } catch (e) {}

    console.log(`[TikTokConnector] ¡Conectado exitosamente a @${username}! Escuchando eventos...`);

    // Mantener vivo el proceso si se cierra la página
    page.on('close', () => {
        console.log(`[TikTokConnector] Página cerrada para @${username}`);
        disconnect(username);
    });

  } catch (error: any) {
    console.error(`[TikTokConnector] Error al conectar @${username}:`, error.message);
    emitter.emitConnectionError({ username, error: error.message });
    await disconnect(username); // Limpiar si falló al inicio
  }
}

export function connect(username: string): void {
  username = username.toLowerCase().replace(/^@/, '');
  if (activeConnections.has(username)) {
    console.log(`[TikTokConnector] Conexión ya activa para @${username}`);
    return;
  }

  interceptAndEmitEvents(username).catch((err) => {
    console.error(`[TikTokConnector] Error fatal en @${username}:`, err);
  });
}

export async function disconnect(username: string): Promise<void> {
  username = username.toLowerCase().replace(/^@/, '');
  const browser = activeConnections.get(username);
  
  if (browser) {
    console.log(`[TikTokConnector] Cerrando conexión para @${username}...`);
    try {
      activeConnections.delete(username); // Eliminar del mapa antes de cerrar para evitar bucles
      await browser.close();
    } catch (e) {
      // Ignorar errores si ya estaba cerrado
    }
    console.log(`[TikTokConnector] Desconectado de @${username}`);
  }
}