### Roadmap y Especificación Técnica

El objetivo es transformar tu código actual en una librería Node.js independiente que expone un servidor WebSocket. Otros servicios (una página web, un bot de Discord, un plugin de OBS) podrán conectarse a *tu servidor* para recibir los eventos de TikTok en tiempo real.

#### Fase 1: Refactorización y Aislamiento del Núcleo

El primer paso es limpiar y organizar el código existente para que no tenga dependencias directas con el entorno de la interfaz de usuario (Electron).

1.  **Aislar el Decodificador de Protobuf:**
    *   Tu archivo `webcastWebsocket2.js` es excelente. Es el motor de bajo nivel. Renómbralo a algo como `TikTokWebsocket.js` para mayor claridad. No necesita cambios.

2.  **Aislar los Parsers de Datos:**
    *   Las funciones como `handleMessageDecoding`, `parseUser`, `parseUserBadges`, etc., que están en `ConexionTiktok.js`, son utilidades puras. Múevelas a su propio archivo, por ejemplo, `src/utils/DataParser.js`. Esto las hace reutilizables y mantiene `ConexionTiktok.js` más limpio.

3.  **Refactorizar `TikTokConnector.js`:**
    *   Esta clase es casi perfecta. La única dependencia a eliminar es `electronVentanas`. Simplemente quítala del constructor y de los lugares donde se use. Esta clase será la orquestadora principal en el servidor.

#### Fase 2: Reemplazar Electron con Puppeteer para Obtener la Conexión

Esta es la parte crucial. Crearemos un nuevo módulo que usa un navegador headless (controlado por código) para obtener la URL y las cookies necesarias.

1.  **Introducir Puppeteer:**
    *   Añade `puppeteer` a las dependencias de tu proyecto (`npm install puppeteer`). Puppeteer te permite controlar un navegador Chrome/Chromium desde Node.js.

2.  **Crear el "Scraper" de Conexión:**
    *   Crea un nuevo archivo, por ejemplo, `src/core/PuppeteerScraper.js`.
    *   Este módulo tendrá una función asíncrona principal, por ejemplo `fetchConnectionParams(username)`.
    *   **Lógica de `fetchConnectionParams`:**
        a.  Lanza una instancia de Puppeteer en modo *headless*.
        b.  Abre una nueva página.
        c.  **Configura la intercepción de red:** Antes de navegar, configura un listener para las peticiones (`page.on('request', ...)`).
        d.  Navega a la URL del live: `https://www.tiktok.com/@${username}/live`.
        e.  Dentro del interceptor de red, busca la URL que contiene `webcast/im/fetch/` o la que corresponde al WebSocket. Cuando la encuentres:
            *   Extrae la URL completa.
            *   Extrae las cookies de la petición.
        f.  Resuelve una promesa con un objeto `{ websocketUrl, cookies }`.
        g.  Cierra el navegador para liberar recursos.
        h.  Maneja errores (usuario no en vivo, CAPTCHAs, etc.).

3.  **Modificar `ConexionTiktok.js`:**
    *   Elimina por completo el método `local` que depende de Electron.
    *   Modifica el método `connect` para que use el nuevo `URLScraper`. Ya no necesitará el parámetro `method`.
    *   El flujo será:
        1.  Llamar a `URLScraper.fetchConnectionParams(this.username)`.
        2.  Con los datos obtenidos, instanciar y conectar `TikTokWebsocket.js` (`webcastWebsocket2.js`).

#### Fase 3: Construir el Servidor WebSocket (La API)

Ahora que tenemos una forma de conectarnos a TikTok sin Electron, construiremos el servidor que expondrá los datos.

1.  **Elegir una Librería de WebSocket Server:**
    *   Usa `ws` (`npm install ws`), que es la librería estándar, ligera y de alto rendimiento para servidores WebSocket en Node.js.

2.  **Crear el Archivo del Servidor:**
    *   Crea un archivo principal, por ejemplo, `server.js`.
    *   **Lógica del `server.js`:**
        a.  Inicia un servidor WebSocket con `ws`.
        b.  Maneja el evento `connection`: cuando un nuevo cliente se conecta a tu API.
        c.  **Gestión de "Salas":** Necesitas saber a qué live de TikTok quiere conectarse cada cliente. El cliente debería enviar un mensaje de "suscripción" justo después de conectarse, por ejemplo: `{"action": "subscribe", "username": "nombredeusuario"}`.
        d.  **Instanciar Conectores:** Por cada `username` de TikTok que se solicita, mantén una única instancia de `TikTokConnector`. Puedes usar un `Map` para almacenar `username -> connectorInstance`.
        e.  **Flujo por Conexión de Cliente:**
            *   Cuando un cliente se suscribe a un `username`:
            *   Si ya existe un `TikTokConnector` para ese `username`, simplemente añade el socket del cliente a una lista de "listeners" para esa sala.
            *   Si no existe, crea una nueva instancia de `TikTokConnector`, llama a su método `connect(username)`, y configura los listeners de eventos (`gift`, `chat`, etc.).
            *   Dentro de cada listener de evento del `TikTokConnector` (ej. `connector.on('gift', ...)`), itera sobre todos los clientes suscritos a esa sala y envíales los datos del evento (`client.send(JSON.stringify({ event: 'gift', data: ... }))`).
        f.  **Manejo de Desconexiones:** Cuando un cliente de tu API se desconecta, elimínalo de la lista de listeners. Si una sala se queda sin listeners, puedes desconectar y destruir la instancia de `TikTokConnector` para ahorrar recursos.

#### Fase 4: Empaquetado y Documentación

1.  **`package.json`:** Define las dependencias (`ws`, `puppeteer`, `protobufjs`) y crea scripts de `npm` (ej. `npm start` para lanzar `server.js`).
2.  **`README.md`:** Documenta tu API. Explica:
    *   Cómo instalar y ejecutar el servidor.
    *   Cómo un cliente debe conectarse (ej. `ws://localhost:8080`).
    *   El formato de los mensajes que el cliente debe enviar (ej. suscripción).
    *   El formato de los eventos que el servidor emitirá (ej. `{"event": "gift", "data": {...}}`).
3.  **Ejemplo de Cliente:** Proporciona un pequeño archivo HTML con JavaScript que muestre cómo conectarse a tu API y mostrar los eventos en la página.

---

### Estructura del Proyecto Recomendada

```
tiktok-live-api/
├── src/
│   ├── core/
│   │   ├── TikTokConnector.js  # Orquestador de alto nivel (refactorizado)
│   │   ├── TikTokWebsocket.js    # Lógica de bajo nivel con Protobuf (antes webcastWebsocket2.js)
│   │   └── PuppeteerScraper.js         # NUEVO: Obtiene la URL/cookies con Puppeteer
│   │
│   ├── server/
│   │   ├── index.js              # Lógica principal del servidor WebSocket (server.js)
│   │   └── RoomManager.js        # (Opcional) Clase para gestionar las salas y los conectores
│   │
│   └── utils/
│       ├── DataParser.js         # Funciones de parseo de datos (de ConexionTiktok.js)
│       └── tiktokSchema.proto    # El esquema de protobuf (lo tienes)
│
├── public/                     # (Opcional) Para un cliente de ejemplo
│   ├── index.html
│   └── client.js
│
├── .env                        # Para variables de entorno (puerto, etc.)
├── package.json
└── README.md
```

### Ejemplo de Código Clave (`PuppeteerScraper.js`)

Aquí tienes un esqueleto para la parte más novedosa de tu proyecto:

```javascript
// src/core/PuppeteerScraper.js
const puppeteer = require('puppeteer');

class URLScraper {
    static async fetchConnectionParams(username) {
        console.log(`[Scraper] Iniciando búsqueda para @${username}`);
        const liveUrl = `https://www.tiktok.com/@${username}/live`;
        let browser = null;

        try {
            browser = await puppeteer.launch({
                headless: true, // true para correr sin interfaz gráfica
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage', // Optimiza para contenedores/servidores
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process', // Puede que no sea necesario
                    '--disable-gpu'
                ]
            });

            const page = await browser.newPage();
            
            // Emular un User-Agent real
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');

            return new Promise(async (resolve, reject) => {
                // Timeout para evitar que se quede colgado indefinidamente
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout: No se pudo encontrar la URL del WebSocket en 30 segundos.'));
                }, 30000);

                page.on('request', async (request) => {
                    const url = request.url();
                    // TikTok usa esta URL para la conexión WebSocket
                    if (url.includes('/webcast/im/fetch/')) {
                        console.log('[Scraper] URL de WebSocket interceptada:', url);
                        
                        // Obtenemos las cookies necesarias de la página
                        const cookies = await page.cookies();
                        const formattedCookies = cookies.map(cookie => ({
                            name: cookie.name,
                            value: cookie.value
                        }));

                        clearTimeout(timeout);
                        resolve({
                            websocketUrl: url,
                            cookies: formattedCookies
                        });
                    }
                });

                await page.goto(liveUrl, {
                    waitUntil: 'networkidle2' // Espera a que la red esté mayormente inactiva
                });

                // Si llegamos aquí y la promesa no se ha resuelto, es probable que el usuario no esté en vivo
                // o que haya un CAPTCHA.
                // Podrías añadir lógica aquí para detectar el mensaje "Live has ended".
                
            });

        } catch (error) {
            console.error(`[Scraper] Error al obtener parámetros para @${username}:`, error);
            throw error; // Re-lanzar para que el llamador lo maneje
        } finally {
            if (browser) {
                await browser.close();
                console.log(`[Scraper] Navegador cerrado para @${username}`);
            }
        }
    }
}

module.exports = URLScraper;
```

Siguiendo este plan, tendrás una librería robusta, modular y completamente independiente de Electron, lista para ser usada como un microservicio de datos de TikTok Live. ¡Mucho éxito con el proyecto