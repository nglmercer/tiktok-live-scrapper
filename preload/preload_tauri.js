// src/interceptor.js

/**
 * Este script se inyectará en la ventana de TikTok Live.
 * Su trabajo es:
 * 1. Cargar las librerías necesarias (protobufjs).
 * 2. Cargar el esquema .proto de TikTok.
 * 3. Reemplazar (monkey-patch) el constructor global `WebSocket`.
 * 4. Cuando la página de TikTok crea un WebSocket, nuestro código lo intercepta.
 * 5. Escucha los mensajes, los decodifica y los envía a la ventana principal de Tauri.
 */
const protobufSCHEME = `
syntax = "proto3";
package TikTok;

// Data structure from im/fetch/ response
message WebcastResponse {
  repeated Message messages = 1;
  string cursor = 2;
  int32 fetchInterval = 3;
  int64 serverTimestamp = 4;
  string internalExt = 5;
  int32 fetchType = 6; // ws (1) or polling (2)
  WebsocketParam wsParam = 7;
  int32 heartbeatDuration = 8;
  bool needAck = 9;
  string wsUrl = 10;
}

message Message {
  string type = 1;
  bytes binary = 2;
}

message WebsocketParam {
  string name = 1;
  string value = 2;
}

// Message types depending on Message.tyoe
message WebcastControlMessage {
  int32 action = 2;
}

// Statistics like viewer count
message WebcastRoomUserSeqMessage {
  repeated TopUser topViewers = 2;
  int32 viewerCount = 3;
}

message TopUser {
  uint64 coinCount = 1;
  User user = 2;
}

message WebcastChatMessage {
  WebcastMessageEvent event = 1;
  User user = 2;
  string comment = 3;
  repeated WebcastSubEmote emotes = 13;
}

// Chat Emotes (Subscriber)
message WebcastEmoteChatMessage {
  User user = 2;
  EmoteDetails emote = 3;
}

message WebcastSubEmote {
 int32 placeInComment = 1; //starting at 0, you insert the emote itself into the comment at that place
 EmoteDetails emote = 2;
}

message WebcastMemberMessage {
  WebcastMessageEvent event = 1;
  User user = 2;
  int32 actionId = 10;
}

message WebcastGiftMessage {
  WebcastMessageEvent event = 1;
  int32 giftId = 2;
  int32 repeatCount = 5;
  User user = 7;
  int32 repeatEnd = 9;
  uint64 groupId = 11;
  WebcastGiftMessageGiftDetails giftDetails = 15;
  string monitorExtra = 22;
  WebcastGiftMessageGiftExtra giftExtra = 23;
}

message WebcastGiftMessageGiftDetails {
  WebcastGiftMessageGiftImage giftImage = 1;
  string giftName = 16;
  string describe = 2;
  int32 giftType = 11;
  int32 diamondCount = 12;
}

// Taken from https://github.com/Davincible/gotiktoklive/blob/da4630622bc586629a53faae64e8c53509af29de/proto/tiktok.proto#L57
message WebcastGiftMessageGiftExtra {
  uint64 timestamp = 6;
  uint64 receiverUserId = 8;
}

message WebcastGiftMessageGiftImage {
  string giftPictureUrl = 1;
}


// Battle start
message WebcastLinkMicBattle {
  repeated WebcastLinkMicBattleItems battleUsers = 10;
}

message WebcastLinkMicBattleItems {
  WebcastLinkMicBattleGroup battleGroup = 2;
}

message WebcastLinkMicBattleGroup {
  LinkUser user = 1;
}


// Battle status
message WebcastLinkMicArmies {
  repeated WebcastLinkMicArmiesItems battleItems = 3;
  int32 battleStatus = 7;
}

message WebcastLinkMicArmiesItems {
  uint64 hostUserId = 1;
  repeated WebcastLinkMicArmiesGroup battleGroups = 2;
}

message WebcastLinkMicArmiesGroup {
  repeated User users = 1;
  int32 points = 2;
}


// Follow & share event
message WebcastSocialMessage {
  WebcastMessageEvent event = 1;
  User user = 2;
}

// Like event (is only sent from time to time, not with every like)
message WebcastLikeMessage {
  WebcastMessageEvent event = 1;
  User user = 5;
  int32 likeCount = 2;
  int32 totalLikeCount = 3;
}

// New question event
message WebcastQuestionNewMessage {
  QuestionDetails questionDetails = 2;
}

message QuestionDetails {
  string questionText = 2;
  User user = 5;
}

message WebcastMessageEvent {
  uint64 msgId = 2;
  uint64 createTime = 4;
  WebcastMessageEventDetails eventDetails = 8;
}

// Contains UI information
message WebcastMessageEventDetails {
  string displayType = 1;
  string label = 2;
}

// Source: Co-opted https://github.com/zerodytrash/TikTok-Livestream-Chat-Connector/issues/19#issuecomment-1074150342
message WebcastLiveIntroMessage {
  uint64 id = 2;
  string description = 4;
  User user = 5;
}

message SystemMessage {
  string description = 2;
}

message WebcastInRoomBannerMessage {
  string data = 2;
}

message RankItem {
  string colour = 1;
  uint64 id = 4;
}

message WeeklyRanking {
  string type = 1;
  string label = 2;
  RankItem rank = 3;
}

message RankContainer {
  WeeklyRanking rankings = 4;
}

message WebcastHourlyRankMessage {
  RankContainer data = 2;
}

message EmoteDetails {
  string emoteId = 1;
  EmoteImage image = 2;
}

message EmoteImage {
  string imageUrl = 1;
}

// Envelope (treasure boxes)
// Taken from https://github.com/ThanoFish/TikTok-Live-Connector/blob/9b215b96792adfddfb638344b152fa9efa581b4c/src/proto/tiktokSchema.proto
message WebcastEnvelopeMessage {
  TreasureBoxData treasureBoxData = 2;
  TreasureBoxUser treasureBoxUser = 1;
}

message TreasureBoxUser {
  TreasureBoxUser2 user2 = 8;
}

message TreasureBoxUser2 {
  repeated TreasureBoxUser3 user3 = 4;
}

message TreasureBoxUser3 {
  TreasureBoxUser4 user4 = 21;
}

message TreasureBoxUser4 {
  User user = 1;
}

message TreasureBoxData {
  uint32 coins = 5;
  uint32 canOpen = 6;
  uint64 timestamp = 7;
}

// New Subscriber message
message WebcastSubNotifyMessage {
  WebcastMessageEvent event = 1;
  User user = 2;
  int32 exhibitionType = 3;
  int32 subMonth = 4;
  int32 subscribeType = 5;
  int32 oldSubscribeStatus = 6;
  int32 subscribingStatus = 8;
}

// ==================================
// Generic stuff

message User {
  uint64 userId = 1;
  string nickname = 3;
  ProfilePicture profilePicture = 9;
  string uniqueId = 38;
  string secUid = 46;
  repeated UserBadgesAttributes badges = 64;
  uint64 createTime = 16;
  string bioDescription = 5;
  FollowInfo followInfo = 22;
}

message FollowInfo {
  int32 followingCount = 1;
  int32 followerCount = 2;
  int32 followStatus = 3;
  int32 pushStatus = 4;
}

message LinkUser {
  uint64 userId = 1;
  string nickname = 2;
  ProfilePicture profilePicture = 3;
  string uniqueId = 4;
}

message ProfilePicture {
  repeated string urls = 1;
}


message UserBadgesAttributes {
  int32 badgeSceneType = 3;
  repeated UserImageBadge imageBadges = 20;
  repeated UserBadge badges = 21;
  PrivilegeLogExtra privilegeLogExtra = 12;
}

message PrivilegeLogExtra {
  string privilegeId = 2;
  string level = 5;
}

message UserBadge {
  string type = 2;
  string name = 3;
}

message UserImageBadge {
  int32 displayType = 1;
  UserImageBadgeImage image = 2;
}

message UserImageBadgeImage {
  string url = 1;
}

// Websocket incoming message structure
message WebcastWebsocketMessage {
  uint64 id = 2;
  string type = 7;
  bytes binary = 8;
}

// Websocket acknowledgment message
message WebcastWebsocketAck {
  uint64 id = 2;
  string type = 7;
}

`
// Variables globales para debug
let debugStats = {
    scriptsLoaded: 0,
    websocketsIntercepted: 0,
    messagesReceived: 0,
    messagesDecoded: 0,
    messagesSent: 0,
    errors: 0,
    startTime: Date.now()
};

// Función de debug centralizada
function debugLog(category, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [Interceptor:${category}]`;
    
    if (data) {
        console.log(`${prefix} ${message}`, data);
    } else {
        console.log(`${prefix} ${message}`);
    }
}

// Función para mostrar estadísticas periódicas
function showStats() {
    const uptime = Math.floor((Date.now() - debugStats.startTime) / 1000);
    debugLog('STATS', `Uptime: ${uptime}s | Scripts: ${debugStats.scriptsLoaded}/2 | WebSockets: ${debugStats.websocketsIntercepted} | Messages: ${debugStats.messagesReceived}/${debugStats.messagesDecoded}/${debugStats.messagesSent} | Errors: ${debugStats.errors}`);
}

// Log inicial cada segundo para verificar que el script está activo
setInterval(() => {
    debugLog('HEARTBEAT', 'Script de inyección activo y funcionando');
    showStats();
}, 10000);
async function loadProtobuf() {
    const strategies = [
        // Estrategia 1: CDN jsDelivr
        {
            name: 'jsDelivr CDN',
            load: async () => {
                await import('https://cdn.jsdelivr.net/npm/protobufjs@7.2.5/dist/protobuf.min.js');
                return window.protobuf;
            }
        },
        // Estrategia 2: CDN unpkg
        {
            name: 'unpkg CDN',
            load: async () => {
                await import('https://unpkg.com/protobufjs@7.2.5/dist/protobuf.min.js');
                return window.protobuf;
            }
        },
        // Estrategia 3: Script tag dinámico
        {
            name: 'Script tag dinámico',
            load: async () => {
                return new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = 'https://cdn.jsdelivr.net/npm/protobufjs@7.2.5/dist/protobuf.min.js';
                    script.onload = () => {
                        if (window.protobuf) {
                            resolve(window.protobuf);
                        } else {
                            reject(new Error('protobuf no disponible después de cargar script'));
                        }
                    };
                    script.onerror = (err) => reject(err);
                    document.head.appendChild(script);
                });
            }
        },
        // Estrategia 4: Archivo local
        {
            name: 'Archivo local',
            load: async () => {
                await import('./protobuf.min.js');
                return window.protobuf;
            }
        },
        // Estrategia 5: Fetch y eval (último recurso)
        {
            name: 'Fetch y eval',
            load: async () => {
                const response = await fetch('https://cdn.jsdelivr.net/npm/protobufjs@7.2.5/dist/protobuf.min.js');
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                const code = await response.text();
                eval(code);
                return window.protobuf;
            }
        }
    ];

    for (const strategy of strategies) {
        try {
            debugLog('LIBS', `Intentando cargar protobuf con estrategia: ${strategy.name}`);
            const protobuf = await strategy.load();
            if (protobuf) {
                debugLog('LIBS', `✅ Protobuf cargado exitosamente con: ${strategy.name}`);
                return protobuf;
            }
        } catch (error) {
            debugLog('LIBS', `❌ Error con estrategia ${strategy.name}:`, error.message);
        }
    }
    
    throw new Error('No se pudo cargar protobuf con ninguna estrategia');
}
// Función para cargar el esquema .proto con múltiples estrategias
async function loadProtoSchema() {
    debugLog('PROTO', 'Cargando esquema desde la constante interna protobufSCHEME');
    
    // La constante protobufSCHEME ya está definida al inicio de este script.
    // Esto elimina la necesidad de buscar y cargar un archivo .proto externo.
    if (typeof protobufSCHEME !== 'string' || protobufSCHEME.length === 0) {
        const errorMsg = 'La constante protobufSCHEME está vacía o no es un string.';
        debugLog('PROTO', `❌ ${errorMsg}`);
        throw new Error(errorMsg);
    }
    
    debugLog('PROTO', `✅ Esquema cargado desde constante (${protobufSCHEME.length} caracteres)`);
    return protobufSCHEME;
}
        async function deserializeWebsocketMessage(binaryMessage) {
            const buffer = new Uint8Array(binaryMessage);
            debugLog('DECODE', `Iniciando decodificación de mensaje (${buffer.byteLength} bytes)`);

            // --- Estrategia 1: Intentar decodificar como WebcastWebsocketMessage (la envoltura principal) ---
            try {
                const decodedWebsocketMessage = WebcastWebsocketMessage.decode(buffer);
                if (decodedWebsocketMessage.type === 'msg' && decodedWebsocketMessage.binary) {
                    debugLog('DECODE', `Detectada envoltura 'WebcastWebsocketMessage' con tipo 'msg'.`);
                    
                    let binary = decodedWebsocketMessage.binary;
                    
                    // Verificar si es Gzip y descomprimir
                    if (binary.length > 2 && binary[0] === 0x1f && binary[1] === 0x8b) {
                        debugLog('DECODE', 'Detectado formato Gzip, descomprimiendo...');
                        binary = await decompressGzip(binary);
                    }
                    
                    // Decodificar el contenido interno como WebcastResponse
                    const response = WebcastResponse.decode(binary);
                    debugLog('DECODE', `WebcastResponse decodificado, mensajes: ${response.messages ? response.messages.length : 0}`);
                    return response; // Devolvemos el contenido, no la envoltura
                }
                 // Si es otro tipo como 'ack', simplemente lo ignoramos por ahora
                debugLog('DECODE', `Mensaje tipo '${decodedWebsocketMessage.type}' manejado, sin datos de evento.`);
                return null;
            } catch (error) {
                debugLog('DECODE', `No es un 'WebcastWebsocketMessage' válido. Intentando como 'WebcastResponse' directo. Error: ${error.message}`);
            }

            // --- Estrategia 2: Si falla lo anterior, intentar decodificar como un WebcastResponse directo ---
            // A veces, el mensaje viene sin la envoltura principal.
            try {
                // El buffer aquí podría estar comprimido con Gzip
                let directBuffer = buffer;
                if (directBuffer.length > 2 && directBuffer[0] === 0x1f && directBuffer[1] === 0x8b) {
                    debugLog('DECODE', 'Detectado formato Gzip en payload directo, descomprimiendo...');
                    directBuffer = await decompressGzip(directBuffer);
                }

                const response = WebcastResponse.decode(directBuffer);
                debugLog('DECODE', `Payload decodificado exitosamente como 'WebcastResponse' directo.`);
                return response;
            } catch (error) {
                debugStats.errors++;
                debugLog('DECODE', `❌ Fallo final en decodificación. No se pudo interpretar el mensaje. Error: ${error.message}`);
                // No relanzamos el error para no detener el proceso por un mensaje malformado.
                return null;
            }
        }
(async () => {
    debugLog('INIT', 'Script inyectado. Iniciando proceso...');

    try {
        // --- Verificar entorno ---
        debugLog('ENV', 'Verificando entorno...');
        debugLog('ENV', `User Agent: ${navigator.userAgent}`);
        debugLog('ENV', `URL actual: ${window.location.href}`);
        debugLog('ENV', `Protocolo: ${window.location.protocol}`);

        // --- Esperar API de Tauri ---
        debugLog('TAURI', 'Esperando API de Tauri...');
        let tauriAttempts = 0;
        const maxTauriAttempts = 200; // 10 segundos máximo
        
        while (!window.__TAURI__ || !window.__TAURI__.event) {
            tauriAttempts++;
            if (tauriAttempts > maxTauriAttempts) {
                throw new Error('Timeout esperando API de Tauri');
            }
            if (tauriAttempts % 20 === 0) { // Log cada segundo (20 * 50ms)
                debugLog('TAURI', `Esperando API de Tauri... (intento ${tauriAttempts}/${maxTauriAttempts})`);
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        debugLog('TAURI', '✅ API de Tauri disponible!');
        const tauriEvent = window.__TAURI__.event;

        // --- 1. Cargar protobuf ---
        debugLog('LIBS', 'Iniciando carga de protobuf...');
        let protobuf;
        try {
            protobuf = await loadProtobuf();
            debugStats.scriptsLoaded++;
            debugLog('LIBS', '✅ Protobuf cargado y disponible');
        } catch (error) {
            debugStats.errors++;
            debugLog('LIBS', '❌ Error fatal cargando protobuf:', error);
            throw error;
        }

        // Verificar que protobuf tiene las funciones necesarias
        const requiredFunctions = ['parse', 'Type', 'Root'];
        for (const func of requiredFunctions) {
            if (!protobuf[func]) {
                debugLog('LIBS', `❌ Función ${func} no disponible en protobuf`);
                throw new Error(`Protobuf incompleto: falta ${func}`);
            }
        }
        debugLog('LIBS', '✅ Protobuf verificado - todas las funciones necesarias están disponibles');

        // --- 2. Cargar esquema .proto ---
        debugLog('PROTO', 'Iniciando carga de esquema .proto...');
        let protoText;
        try {
            protoText = await loadProtoSchema();
            debugStats.scriptsLoaded++;
            debugLog('PROTO', '✅ Esquema .proto cargado exitosamente');
        } catch (error) {
            debugStats.errors++;
            debugLog('PROTO', '❌ Error cargando esquema .proto:', error);
            throw error;
        }

        // Parsear esquema
        debugLog('PROTO', 'Parseando esquema .proto...');
        let root;
        try {
            const parsed = protobuf.parse(protoText);
            root = parsed.root;
            debugLog('PROTO', '✅ Esquema .proto parseado exitosamente');
        } catch (error) {
            debugStats.errors++;
            debugLog('PROTO', '❌ Error parseando esquema .proto:', error);
            throw error;
        }

        // Verificar tipos necesarios
        const requiredTypes = [
            'TikTok.WebcastWebsocketMessage',
            'TikTok.WebcastResponse',
            'TikTok.WebcastChatMessage',
            'TikTok.WebcastGiftMessage',
            'TikTok.WebcastLikeMessage',
            'TikTok.WebcastMemberMessage',
            'TikTok.WebcastSocialMessage',
            'TikTok.WebcastRoomUserSeqMessage',
            'TikTok.WebcastSubNotifyMessage'
        ];

        let typesFound = 0;
        for (const typeName of requiredTypes) {
            try {
                const type = root.lookupType(typeName);
                debugLog('PROTO', `✅ Tipo ${typeName} encontrado`);
                typesFound++;
            } catch (error) {
                debugLog('PROTO', `❌ Tipo ${typeName} no encontrado:`, error.message);
            }
        }
        
        if (typesFound === 0) {
            throw new Error('No se encontraron tipos necesarios en el esquema');
        }
        
        debugLog('PROTO', `✅ Tipos encontrados: ${typesFound}/${requiredTypes.length}`);

        const WebcastWebsocketMessage = root.lookupType("TikTok.WebcastWebsocketMessage");
        const WebcastResponse = root.lookupType("TikTok.WebcastResponse");
        const protoMessageTypes = {
            'WebcastChatMessage': 'chat',
            'WebcastGiftMessage': 'gift',
            'WebcastLikeMessage': 'like',
            'WebcastMemberMessage': 'member',
            'WebcastSocialMessage': 'social',
            'WebcastRoomUserSeqMessage': 'roomUser',
            'WebcastSubNotifyMessage': 'subscribe',
        };

        debugLog('PROTO', 'Tipos de mensajes configurados:', protoMessageTypes);
        
        // --- 3. Lógica de Decodificación ---

        // Verificar soporte para DecompressionStream
        if (!window.DecompressionStream) {
            debugLog('GZIP', '❌ DecompressionStream no disponible - descompresión GZIP deshabilitada');
        } else {
            debugLog('GZIP', '✅ DecompressionStream disponible');
        }

        async function decompressGzip(gzipBuffer) {
            debugLog('GZIP', `Descomprimiendo buffer gzip de ${gzipBuffer.length} bytes`);
            
            if (!window.DecompressionStream) {
                debugLog('GZIP', '❌ DecompressionStream no disponible, devolviendo buffer original');
                return gzipBuffer;
            }
            
            try {
                const ds = new DecompressionStream('gzip');
                const writer = ds.writable.getWriter();
                writer.write(gzipBuffer);
                writer.close();

                const reader = ds.readable.getReader();
                const chunks = [];
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                }

                // Concatenar los chunks en un solo Uint8Array
                const totalLength = chunks.reduce((acc, val) => acc + val.length, 0);
                const concatenated = new Uint8Array(totalLength);
                let offset = 0;
                for (const chunk of chunks) {
                    concatenated.set(chunk, offset);
                    offset += chunk.length;
                }
                
                debugLog('GZIP', `✅ Descompresión exitosa: ${gzipBuffer.length} -> ${concatenated.length} bytes`);
                return concatenated;
            } catch (error) {
                debugStats.errors++;
                debugLog('GZIP', '❌ Error en descompresión:', error);
                throw error;
            }
        }

        async function deserializeWebsocketMessage(binaryMessage) {
            debugLog('DECODE', `Iniciando decodificación de mensaje (${binaryMessage.byteLength} bytes)`);
            
            try {
                // En el navegador, el mensaje es un ArrayBuffer, lo convertimos a Uint8Array
                const buffer = new Uint8Array(binaryMessage);
                debugLog('DECODE', `Buffer convertido a Uint8Array`);
                
                const decodedWebsocketMessage = WebcastWebsocketMessage.decode(buffer);
                debugLog('DECODE', `Mensaje WebSocket decodificado, tipo: ${decodedWebsocketMessage.type}`);

                if (decodedWebsocketMessage.type === 'msg') {
                    let binary = decodedWebsocketMessage.binary;
                    debugLog('DECODE', `Mensaje tipo 'msg', binary length: ${binary ? binary.length : 'null'}`);
                    
                    // Verificar si es Gzip y descomprimir
                    if (binary && binary.length > 2 && binary[0] === 0x1f && binary[1] === 0x8b) {
                        debugLog('DECODE', 'Detectado formato Gzip, descomprimiendo...');
                        binary = await decompressGzip(binary);
                    }
                    
                    const response = WebcastResponse.decode(binary);
                    debugLog('DECODE', `WebcastResponse decodificado, mensajes: ${response.messages ? response.messages.length : 0}`);

                    if (response.messages) {
                        // Decodificar mensajes anidados
                        let decodedCount = 0;
                        for (const message of response.messages) {
                            const messageType = message.type;
                            if (protoMessageTypes[messageType]) {
                                try {
                                    const messageProto = root.lookupType(`TikTok.${messageType}`);
                                    message.decodedData = messageProto.decode(message.binary);
                                    decodedCount++;
                                    debugLog('DECODE', `✅ Mensaje ${messageType} decodificado exitosamente`);
                                } catch (err) {
                                    debugStats.errors++;
                                    debugLog('DECODE', `❌ Error decodificando ${messageType}:`, err);
                                }
                            } else {
                                debugLog('DECODE', `❓ Tipo de mensaje desconocido: ${messageType}`);
                            }
                        }
                        debugLog('DECODE', `✅ Total de mensajes decodificados: ${decodedCount}/${response.messages.length}`);
                    }
                    return response;
                }
                return decodedWebsocketMessage;
            } catch (error) {
                debugStats.errors++;
                debugLog('DECODE', '❌ Error general en decodificación:', error);
                throw error;
            }
        }

        // --- 4. Monkey-Patching del WebSocket ---
        debugLog('WEBSOCKET', 'Iniciando monkey-patch del WebSocket...');
        const OriginalWebSocket = window.WebSocket;
        
        if (!OriginalWebSocket) {
            throw new Error('WebSocket no disponible en este entorno');
        }
        
        window.WebSocket = function(url, protocols) {
            debugLog('WEBSOCKET', `Nuevo WebSocket creado para: ${url}`);
            // Solo nos interesan los WebSockets de TikTok
            if (!url.includes('tiktok.com') && !url.startsWith('ws')) {
                debugLog('WEBSOCKET', 'WebSocket no es de TikTok, ignorando');
                return new OriginalWebSocket(url, protocols);
            }

            debugStats.websocketsIntercepted++;
            debugLog('WEBSOCKET', `🎯 ¡Interceptando WebSocket de TikTok! (${debugStats.websocketsIntercepted})`);
            const ws = new OriginalWebSocket(url, protocols);

            // ¡IMPORTANTE! Pedir los datos en formato binario
            ws.binaryType = 'arraybuffer';
            debugLog('WEBSOCKET', '✅ BinaryType configurado como arraybuffer');

            // Interceptar eventos del WebSocket
            const originalAddEventListener = ws.addEventListener;
            ws.addEventListener = function(type, listener, options) {
                debugLog('WEBSOCKET', `addEventListener interceptado para evento: ${type}`);
                
             
                if (type === 'message') {
                    const newListener = async (event) => {
                        // El mensaje original sigue su curso para que la página de TikTok no se rompa.
                        listener(event); 

                        // Nuestro trabajo extra comienza aquí
                        debugStats.messagesReceived++;
                        debugLog('MESSAGE', `📨 Mensaje recibido (#${debugStats.messagesReceived}), tamaño: ${event.data.byteLength || 0} bytes`);
                        
                        try {
                            // 1. Decodificar usando nuestra función robusta
                            const decodedResponse = await deserializeWebsocketMessage(event.data);
                            
                            // Si la decodificación fue exitosa y contiene mensajes
                            if (decodedResponse && decodedResponse.messages) {
                                debugStats.messagesDecoded++;
                                
                                // 2. Filtrar y mapear los mensajes a eventos
                                const events = decodedResponse.messages
                                    .map(msg => {
                                        // Intentar decodificar el payload interno de cada mensaje
                                        const eventName = protoMessageTypes[msg.type];
                                        if (eventName) {
                                            try {
                                                const messageProto = root.lookupType(`TikTok.${msg.type}`);
                                                const decodedData = messageProto.decode(msg.binary);
                                                return { eventName, data: decodedData };
                                            } catch (err) {
                                                debugStats.errors++;
                                                debugLog('MESSAGE', `❌ Error decodificando payload de '${msg.type}':`, err.message);
                                                return null;
                                            }
                                        }
                                        return null;
                                    })
                                    .filter(event => event !== null); // Quitar los que no se pudieron decodificar

                                // 3. Emitir los eventos a Tauri si hay alguno
                                if (events.length > 0) {
                                    try {
                                        console.log('EVENTS', `Enviando ${events.length} eventos a Tauri:`,events);
                                        await tauriEvent.emit('tiktok-event', events);
                                        debugStats.messagesSent++;
                                        debugLog('MESSAGE', `🚀 Eventos enviados a Tauri (#${debugStats.messagesSent}):`, events.map(e => e.eventName));
                                    } catch (emitError) {
                                        debugStats.errors++;
                                        debugLog('MESSAGE', '❌ Error enviando eventos a Tauri:', emitError);
                                    }
                                }
                            } else {
                                debugLog('MESSAGE', `❓ Mensaje procesado pero no contenía eventos decodificables.`);
                            }
                        } catch (err) {
                            // Este catch es para errores inesperados en el flujo, no en la decodificación misma.
                            debugStats.errors++;
                            debugLog('MESSAGE', '❌ Error fatal procesando mensaje:', err);
                        }
                    };
                    originalAddEventListener.call(this, type, newListener, options);
                } else {
                    originalAddEventListener.call(this, type, listener, options);
                }

            };

            // Interceptar otros eventos importantes del WebSocket
            ws.addEventListener('open', () => {
                debugLog('WEBSOCKET', '✅ WebSocket abierto');
            });

            ws.addEventListener('close', (event) => {
                debugLog('WEBSOCKET', `❌ WebSocket cerrado. Código: ${event.code}, Razón: ${event.reason}`);
            });

            ws.addEventListener('error', (error) => {
                debugStats.errors++;
                debugLog('WEBSOCKET', '❌ Error en WebSocket:', error);
            });

            return ws;
        };

        // Mantener propiedades del WebSocket original
        window.WebSocket.prototype = OriginalWebSocket.prototype;
        window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
        window.WebSocket.OPEN = OriginalWebSocket.OPEN;
        window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
        window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

        debugLog('WEBSOCKET', '✅ WebSocket monkey-patch completado exitosamente');
        debugLog('INIT', '🎉 ¡Inicialización completada exitosamente! Esperando conexiones...');

    } catch (error) {
        debugStats.errors++;
        debugLog('INIT', '💥 Error fatal durante la inicialización:', error);
        
        // Mostrar un resumen detallado del error
        console.error('=== ERROR FATAL EN INTERCEPTOR ===');
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
        console.error('Stats:', debugStats);
        console.error('URL:', window.location.href);
        console.error('User Agent:', navigator.userAgent);
        console.error('Tiempo transcurrido:', Date.now() - debugStats.startTime, 'ms');
        console.error('=====================================');
        
        // Intentar continuar con funcionalidad limitada
        debugLog('INIT', '🔄 Intentando continuar con funcionalidad limitada...');
    }
})();