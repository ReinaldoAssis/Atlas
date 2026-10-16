/**
 * Harness: mede layout do app em viewport de celular via Chrome DevTools Protocol.
 * Uso: node tools/probe.mjs <url> <script-file>
 */
import { readFileSync } from 'node:fs';

const [, , url, scriptPath, width = '390', height = '844'] = process.argv;
const expression = readFileSync(scriptPath, 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('nenhum target de página');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

ws.addEventListener('message', (event) => {
	const msg = JSON.parse(event.data);
	if (msg.id && pending.has(msg.id)) {
		pending.get(msg.id)(msg);
		pending.delete(msg.id);
	}
});

await new Promise((resolve) => ws.addEventListener('open', resolve));

function send(method, params = {}) {
	const messageId = ++id;
	ws.send(JSON.stringify({ id: messageId, method, params }));
	return new Promise((resolve) => pending.set(messageId, resolve));
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
	width: Number(width),
	height: Number(height),
	deviceScaleFactor: 2,
	mobile: true
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url });
await sleep(3500);

const result = await send('Runtime.evaluate', {
	expression,
	awaitPromise: true,
	returnByValue: true
});

console.log(JSON.stringify(result.result?.result?.value ?? result.result, null, 2));

const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
if (shot.result?.data) {
	const { writeFileSync } = await import('node:fs');
	writeFileSync('/tmp/atlas-probe.png', Buffer.from(shot.result.data, 'base64'));
	console.log('screenshot: /tmp/atlas-probe.png');
}

ws.close();
process.exit(0);
