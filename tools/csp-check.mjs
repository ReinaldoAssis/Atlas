/**
 * Harness: valida a CSP de `src-tauri/tauri.conf.json` num Chromium real.
 *
 * Por que existe: o Tauri só aplica a CSP quando o HTML sai do protocolo
 * `tauri://localhost` (ver `tauri/src/manager/mod.rs`, `get_asset`). `vite dev`
 * e `tauri dev` (devUrl = Vite) **não** exercitam a política, então "funciona em
 * dev" não diz nada sobre o app empacotado. Este script serve o build estático
 * (`npm run build`) com a mesma política como cabeçalho HTTP e roda o app de
 * verdade num Chromium headless, coletando `securitypolicyviolation`.
 *
 * Divergência conhecida: no build, o Tauri injeta nonces/hashes nos
 * `<script>`/`<style>` do HTML. Aqui os hashes dos scripts inline são
 * recalculados (o que o Tauri faz) e o nonce é dispensável porque a política já
 * permite `'self'`. Não há injeção de nonce em `style-src`, então
 * `'unsafe-inline'` continua valendo — igual ao build, que não tem `<style>`
 * inline no `index.html`.
 *
 * Uso:
 *   npm run build
 *   node tools/csp-check.mjs            # roda e imprime o relatório
 *   node tools/csp-check.mjs --shot     # também salva /tmp/atlas-csp.png
 *
 * Sai com código 1 se houver violação de CSP ou verificação falhada.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'build');
const CONF = join(ROOT, 'src-tauri/tauri.conf.json');
const CHROME =
	process.env.ATLAS_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.ATLAS_CSP_PORT ?? 4399);
const CDP_PORT = Number(process.env.ATLAS_CSP_CDP_PORT ?? 9333);
const WANT_SHOT = process.argv.includes('--shot');

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ico': 'image/x-icon',
	'.webmanifest': 'application/manifest+json'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Política: config -> string de cabeçalho                             */
/* ------------------------------------------------------------------ */

function directiveString(sources) {
	return Array.isArray(sources) ? sources.join(' ') : String(sources);
}

function policyFromConfig() {
	const conf = JSON.parse(readFileSync(CONF, 'utf8'));
	const csp = conf.app?.security?.csp;
	if (!csp) throw new Error('app.security.csp está vazio — nada para checar');
	if (typeof csp === 'string') return csp;
	return Object.entries(csp)
		.map(([directive, sources]) => `${directive} ${directiveString(sources)}`)
		.join('; ');
}

/** Mesma ideia do Tauri: hash sha256 dos scripts inline do index.html. */
function inlineScriptHashes(html) {
	const hashes = [];
	const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
	for (const [, body] of html.matchAll(re)) {
		if (!body.trim()) continue;
		hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
	}
	return hashes;
}

function policyWithScriptHashes(indexHtml) {
	const hashes = inlineScriptHashes(indexHtml);
	if (!hashes.length) return policyFromConfig();
	return policyFromConfig().replace(/(script-src[^;]*)/, (match) => `${match} ${hashes.join(' ')}`);
}

/* ------------------------------------------------------------------ */
/* Servidor estático + página de primitivas                            */
/* ------------------------------------------------------------------ */

async function startServer(policy) {
	const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8');
	if (process.env.ATLAS_CSP_DUMP) await writeFile('/tmp/atlas-csp-probe.html', probeHtml());
	const server = createServer(async (request, response) => {
		const path = new URL(request.url, 'http://localhost').pathname;
		const headers = { 'Content-Security-Policy': policy };
		if (path === '/favicon.ico') {
			response.writeHead(204, headers);
			response.end();
			return;
		}
		if (path === '/__csp-probe') {
			const html = probeHtml();
			const probePolicy = policy.replace(/(script-src[^;]*)/, (match) =>
				`${match} ${inlineScriptHashes(html).join(' ')}`
			);
			response.writeHead(200, { 'content-type': MIME['.html'], 'Content-Security-Policy': probePolicy });
			response.end(html);
			return;
		}
		const file = path === '/' ? join(DIST, 'index.html') : join(DIST, path);
		try {
			const body = file.endsWith('index.html') ? Buffer.from(indexHtml) : readFileSync(file);
			const type = MIME[extname(file)] ?? 'application/octet-stream';
			response.writeHead(200, { ...headers, 'content-type': type });
			response.end(body);
		} catch {
			response.writeHead(404, { ...headers, 'content-type': 'text/plain' });
			response.end('not found');
		}
	});
	await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
	return server;
}

/**
 * Primitivas que a CSP precisa cobrir. Cada uma reporta sucesso por um sinal
 * observável (`naturalWidth`, mensagens postMessage, valores de estilo).
 *
 * Nota: o `srcdoc` de um iframe criado por script (é o que o `ArtifactFrame` faz)
 * renderiza o HTML normalmente, mas neste ambiente (Chromium headless via CDP) o
 * script interno não entrega `postMessage` ao documento pai, mesmo com um
 * `srcdoc` equivalente declarado no HTML entregando sob a mesma política — ou
 * seja, não é a CSP que bloqueia. O harness então cobre o `srcdoc` estático
 * (prova `frame-src` + execução) e o `srcdoc` do artefato no app (prova que
 * monta e renderiza: o `--shot` mostra o conteúdo do artefato na tela).
 */
function probeHtml() {
	return `<!doctype html><html><head><meta charset="utf-8">
<style>.stylesheet{color:rgb(1, 2, 3)}</style></head>
<body style="background:rgb(9, 9, 9)">
<script>window.__probe = { messages: [], worker: null }; addEventListener('message', (event) => window.__probe.messages.push(event.data));</script>
<div id="inline-style" class="stylesheet">estilo</div>
<img id="data" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
<img id="blob">
<iframe id="srcdoc" sandbox="allow-scripts" srcdoc="<script>parent.postMessage('srcdoc-script','*')<\/script>"></iframe>
<script>
// style attribute aplicado em runtime (é o que o Svelte faz em \`style={...}\`)
const runtime = document.createElement('div');
runtime.setAttribute('style', 'color: rgb(4, 5, 6)');
document.body.append(runtime);
window.__probe.runtimeStyle = getComputedStyle(runtime).color;

// blob: usado por anexos e pelo preview de imagens das notas
const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>'], { type: 'image/svg+xml' });
document.getElementById('blob').src = URL.createObjectURL(svg);

// worker-src blob: (o Vite não gera worker aqui, mas a diretiva fica coberta)
const workerSource = new Blob(["postMessage('worker-ok')"], { type: 'text/javascript' });
const worker = new Worker(URL.createObjectURL(workerSource));
worker.onmessage = (event) => { window.__probe.worker = event.data; };
</script></body></html>`;
}

/* ------------------------------------------------------------------ */
/* CDP                                                                 */
/* ------------------------------------------------------------------ */

async function launchChrome(profile) {
	const child = spawn(
		CHROME,
		[
			'--headless=new',
			'--disable-gpu',
			'--no-first-run',
			'--no-default-browser-check',
			`--user-data-dir=${profile}`,
			`--remote-debugging-port=${CDP_PORT}`,
			'about:blank'
		],
		{ stdio: 'ignore' }
	);
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
			return child;
		} catch {
			await sleep(200);
		}
	}
	child.kill();
	throw new Error('Chrome não abriu a porta de depuração');
}

async function connect() {
	const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json());
	const page = targets.find((t) => t.type === 'page');
	if (!page) throw new Error('nenhum target de página no Chrome');
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	let nextId = 0;
	const pending = new Map();
	socket.addEventListener('message', (event) => {
		const message = JSON.parse(event.data);
		if (message.id && pending.has(message.id)) {
			pending.get(message.id)(message);
			pending.delete(message.id);
		}
	});
	await new Promise((r) => socket.addEventListener('open', r));
	const send = (method, params = {}) => {
		const id = ++nextId;
		socket.send(JSON.stringify({ id, method, params }));
		return new Promise((r) => pending.set(id, r)).then((m) => {
			if (m.error) throw new Error(`${method}: ${m.error.message}`);
			return m.result;
		});
	};
	const evaluate = async (expression, contextId) => {
		const result = await send('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true,
			...(contextId ? { contextId } : {})
		});
		if (result.exceptionDetails) {
			throw new Error(`evaluate falhou: ${result.exceptionDetails.text} ${result.result?.description ?? ''}`);
		}
		return result.result?.value;
	};
	return { socket, send, evaluate };
}

/** Nota rica em markdown: é o caminho que mais depende de CSP (Carta + KaTeX + Shiki + artefato). */
function richNoteBody() {
	return [
		'# Título',
		'',
		'Texto com **negrito** e `código inline`.',
		'',
		'- [x] tarefa',
		'- [ ] outra',
		'',
		'$$e^{i\\pi}+1=0$$',
		'',
		'```js',
		"const a = 1; // Shiki",
		'```',
		'',
		'| a | b |',
		'| - | - |',
		'| 1 | 2 |',
		'',
		'Ver [[outra nota]] e #tag.',
		'',
		'![pixel](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)',
		'',
		'```artifact',
		'<h1 id="ok">artefato</h1><script>parent.postMessage("artifact-script","*")</script>',
		'```'
	].join('\n');
}

function seedNotes() {
	const now = new Date().toISOString();
	const state = {
		notes: [
			{
				id: 'csp-note',
				folderId: null,
				title: 'Nota de CSP',
				body: richNoteBody(),
				tags: ['tag'],
				pinned: false,
				createdAt: now,
				updatedAt: now,
				trashedAt: null
			}
		],
		folders: []
	};
	return `try { localStorage.setItem('atlas-preview-notes-v1', ${JSON.stringify(
		JSON.stringify(state)
	)}); } catch {}`;
}

const COLLECTOR = `window.__csp = [];
window.__messages = [];
function __record(event) {
	window.__csp.push({
		directive: event.violatedDirective,
		blocked: String(event.blockedURI).slice(0, 120),
		sample: String(event.sample ?? '').slice(0, 80),
		source: String(event.sourceFile ?? '').split('/').pop()
	});
}
document.addEventListener('securitypolicyviolation', __record);
addEventListener('securitypolicyviolation', __record);
addEventListener('message', (event) => {
	const data = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
	window.__messages.push(data);
});
/* Frames filhos (iframe de artefato, origem opaca) não são visualizáveis do
   documento pai: eles relatam violações por postMessage. */
document.addEventListener('securitypolicyviolation', (event) => {
	try {
		if (parent !== window) parent.postMessage(JSON.stringify({ __cspViolation: event.violatedDirective, blocked: String(event.blockedURI), sample: String(event.sample ?? '').slice(0, 120) }), '*');
	} catch {}
});`;

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

async function main() {
	const policy = policyWithScriptHashes(readFileSync(join(DIST, 'index.html'), 'utf8'));
	const server = await startServer(policy);
	const profile = await mkdtemp(join(tmpdir(), 'atlas-csp-'));
	const chrome = await launchChrome(profile);

	const results = [];
	const record = (name, ok, detail = '') => results.push({ name, ok, detail });

	try {
		const { socket, send, evaluate } = await connect();
		await send('Page.enable');
		await send('Runtime.enable');
		await send('Log.enable');
		await send('Network.enable');
		await send('Page.addScriptToEvaluateOnNewDocument', { source: COLLECTOR });
		await send('Page.addScriptToEvaluateOnNewDocument', { source: seedNotes() });
		await send('Emulation.setDeviceMetricsOverride', {
			width: 390,
			height: 844,
			deviceScaleFactor: 2,
			mobile: true
		});
		await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

		const consoleErrors = [];
		const networkFailures = [];
		socket.addEventListener('message', (event) => {
			const message = JSON.parse(event.data);
			if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
				consoleErrors.push(message.params.entry.text.slice(0, 160));
			}
			if (message.method === 'Runtime.exceptionThrown') {
				const details = message.params.exceptionDetails;
				consoleErrors.push(
					`EXCEÇÃO ${details.text} ${details.exception?.description?.split('\n')[0] ?? ''}`.slice(0, 200)
				);
			}
			if (
				message.method === 'Network.responseReceived' &&
				message.params.response.status >= 400 &&
				!message.params.response.url.startsWith('data:')
			) {
				networkFailures.push(`${message.params.response.status} ${message.params.response.url}`);
			}
		});

		/* ---- 1. app real: boot ---- */
		await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
		await sleep(3500);
		record('app: boot', await evaluate('Boolean(document.querySelector("main, #bn"))'));
		record(
			'app: folha de estilo externa aplicada',
			(await evaluate('getComputedStyle(document.body).fontFamily')) !== ''
		);

		/* ---- 2. app real: notas -> preview -> artefato ---- */
		const opened = await evaluate(`(async () => {
			const click = (selector) => { const el = document.querySelector(selector); if (el) el.click(); return Boolean(el); };
			const byText = (root, text) => [...document.querySelectorAll(root)].find((el) => el.textContent.trim() === text);
			click('button[aria-label="Mais"]');
			await new Promise((r) => setTimeout(r, 300));
			byText('#mm .mi', 'Notas')?.click();
			await new Promise((r) => setTimeout(r, 500));
			const row = document.querySelector('.nt-row-main');
			if (!row) return { error: 'linha de nota não encontrada' };
			row.click();
			await new Promise((r) => setTimeout(r, 600));
			const preview = [...document.querySelectorAll('.nt-seg button')].find((b) => b.textContent.trim() === 'Ler');
			if (!preview) return { error: 'botão "Ler" não encontrado' };
			preview.click();
			await new Promise((r) => setTimeout(r, 1200));
			const pane = document.querySelector('.nt-pv');
			return {
				html: pane?.innerHTML.length ?? 0,
				katex: Boolean(document.querySelector('.katex')),
				code: Boolean(document.querySelector('.nt-pv pre code, .nt-pv pre span')),
				table: Boolean(document.querySelector('.nt-pv table')),
				wiki: Boolean(document.querySelector('.nt-pv .wl')),
				image: document.querySelector('.nt-pv img')?.complete ?? null,
				artifact: Boolean(document.querySelector('.nt-artifact-action'))
			};
		})()`);
		if (opened?.error) record(`app: notas (${opened.error})`, false);
		else {
			record('app: markdown renderizado', opened.html > 200, `html=${opened.html}`);
			record('app: KaTeX', opened.katex);
			record('app: trecho de código (Shiki)', opened.code);
			record('app: tabela GFM', opened.table);
			record('app: wiki-link', opened.wiki);
			record('app: imagem data:', opened.image === true);
			record('app: fence de artefato', opened.artifact);
		}

		/* ---- 3. app real: iframe do artefato monta (frame-src/srcdoc) ---- */
		await evaluate(`document.querySelector('.nt-artifact-action')?.click()`);
		await sleep(900);
		const artifact = await evaluate(`({
			exists: Boolean(document.querySelector('.nt-artifact-frame')),
			srcdoc: (document.querySelector('.nt-artifact-frame')?.getAttribute('srcdoc') ?? '').length
		})`);
		record('app: iframe do artefato monta', Boolean(artifact?.exists), `srcdoc=${artifact?.srcdoc}`);
		record(
			'app: zero violações de CSP',
			(await evaluate('window.__csp.length')) === 0,
			JSON.stringify(await evaluate('window.__csp'))
		);

		if (WANT_SHOT) {
			const shot = await send('Page.captureScreenshot', { format: 'png' });
			await writeFile('/tmp/atlas-csp.png', Buffer.from(shot.data, 'base64'));
		}

		/* ---- 4. primitivas isoladas ---- */
		await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/__csp-probe` });
		await sleep(1200);
		const probe = await evaluate(`(async () => {
			await new Promise((r) => setTimeout(r, 400));
			return {
				stylesheet: getComputedStyle(document.getElementById('inline-style')).color,
				attribute: document.body.getAttribute('style'),
				runtimeStyle: window.__probe.runtimeStyle,
				dataImage: document.getElementById('data').naturalWidth > 0,
				blobImage: document.getElementById('blob').naturalWidth > 0,
				worker: window.__probe.worker,
				srcdoc: window.__probe.messages.includes('srcdoc-script'),
				violations: window.__csp
			};
		})()`);
		record('probe: <style> inline no documento', probe.stylesheet === 'rgb(1, 2, 3)', probe.stylesheet);
		record('probe: style="" no HTML (style-src-attr)', Boolean(probe.attribute), String(probe.attribute));
		record('probe: style via setAttribute', probe.runtimeStyle === 'rgb(4, 5, 6)', probe.runtimeStyle);
		record('probe: img data:', probe.dataImage);
		record('probe: img blob:', probe.blobImage);
		record('probe: worker blob:', probe.worker === 'worker-ok', String(probe.worker));
		record('probe: iframe srcdoc executa (frame-src)', probe.srcdoc);

		const violations = probe.violations ?? [];
		record('probe: zero violações de CSP', violations.length === 0, JSON.stringify(violations));
		const cspConsole = consoleErrors.filter((text) => /Content Security Policy|Refused to/i.test(text));
		record('console: sem erros de CSP', cspConsole.length === 0, cspConsole.slice(0, 3).join(' | '));
		const jsErrors = consoleErrors.filter((text) => !/navigator\.vibrate/.test(text));
		record('console: sem erros de JS', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));
		record(
			'rede: sem respostas 4xx/5xx',
			networkFailures.length === 0,
			[...new Set(networkFailures)].slice(0, 5).join(' | ')
		);

		socket.close();
	} catch (error) {
		record('harness: exceção', false, error?.message ?? String(error));
	} finally {
		chrome.kill('SIGKILL');
		server.close();
		await sleep(300);
		await rm(profile, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
	}

	const failed = results.filter((r) => !r.ok);
	for (const { name, ok, detail } of results) {
		console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
	}
	console.log(`\n${results.length - failed.length}/${results.length} verificações ok`);
	process.exit(failed.length ? 1 : 0);
}

await main();
