// src/core/PuppeteerScraper.js
const { deserializeWebsocketMessage, serializeMessage } = require('./messageDecoder');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const TIMEOUT_MS = 60000; // 60 seconds timeout

/**
 * Fetches WebSocket connection parameters for a TikTok LIVE stream using Puppeteer.
 * It launches a headless browser, navigates to the user's LIVE page,
 * and intercepts the WebSocket creation request to extract the URL and cookies.
 *
 * @param {string} username The TikTok username.
 * @returns {Promise<{websocketUrl: string, cookies: any[]}>} A promise that resolves with the connection parameters.
 * @throws {Error} If the connection parameters cannot be fetched within the timeout period or if the user is not live.
 */
async function fetchConnectionParamsWithPuppeteer(username) {
    const liveUrl = `https://www.tiktok.com/@${username}/live`;
    let browser = null;

    console.log(`[Puppeteer] Launching browser for @${username}...`);

    try {
        browser = await puppeteer.launch({ headless: 'new' });
        const page = await browser.newPage();
        
        // Use a Promise to wait for the WebSocket URL
        const wsUrlPromise = new Promise(async (resolve, reject) => {
            const client = await page.target().createCDPSession();
            await client.send('Network.enable');

            // Listen for WebSocket creation
            client.on('Network.webSocketCreated', ({ url }) => {
                // TikTok uses multiple WebSockets, we need the one for Webcast
                if (url.includes('webcast')) {
                    console.log(`[Puppeteer] Intercepted Webcast WebSocket URL: ${url}`);
                    resolve(url);
                }
            });

            // Optional: Handle case where user is not live
            page.on('response', response => {
                if (response.url().includes('/api/live/detail')) {
                    response.json().then(data => {
                        // status: 4 -> Stream ended. 2 -> Is live.
                        if (data.data && data.data.status === 4) {
                            reject(new Error(`Stream for @${username} has ended or the user is not live.`));
                        }
                    }).catch(() => { /* ignore json parsing errors */ });
                }
            });
        });

        console.log(`[Puppeteer] Navigating to ${liveUrl}...`);
        await page.goto(liveUrl, { waitUntil: 'domcontentloaded' });

        // Race the WebSocket discovery against a timeout
        const websocketUrl = await Promise.race([
            wsUrlPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Puppeteer timed out waiting for WebSocket URL.')), TIMEOUT_MS))
        ]);

        console.log(`[Puppeteer] Fetching cookies...`);
        const cookies = await page.cookies(liveUrl);

        return { websocketUrl, cookies };

    } catch (error) {
        console.error(`[Puppeteer] Error fetching connection parameters for @${username}:`, error.message);
        // Re-throw the error to be caught by TikTokConnector
        throw error;
    } finally {
        if (browser) {
            console.log(`[Puppeteer] Closing browser.`);
            await browser.close();
        }
    }
}

module.exports = {
    fetchConnectionParamsWithPuppeteer
};