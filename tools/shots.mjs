/**
 * Harness: gera as imagens do README do Atlas (capturas desktop/mobile,
 * banner 1600×640 e logo 512×512) a partir do build estático, num Chromium
 * headless controlado por CDP.
 *
 * Por que existe: as imagens do README precisam ser reproduzíveis e não podem
 * depender de dados reais. O script sobe o app em **modo de teste** (banco
 * separado, fixtures) com a UI em inglês, navega pelas abas, aplica uma
 * limpeza (sem toast, sem controles de dev, sem animação) e captura.
 *
 * Uso:
 *   npm run shots                     # build (se preciso) + captura tudo
 *   npm run shots -- --only=time      # só uma captura (sem banner/logo)
 *   npm run shots -- --out=/tmp/x     # outro diretório
 *   npm run shots -- --no-build       # confia no build/ atual
 *   npm run shots -- --keep           # mantém o perfil do Chrome em /tmp
 *
 * Requer: Google Chrome (ou ATLAS_CHROME=/caminho/do/chrome).
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'build');
const OUT = resolve(ROOT, argValue('out', 'docs/assets'));
const ONLY = argValue('only', '')
	.split(',')
	.map((item) => item.trim())
	.filter(Boolean);
const NO_BUILD = process.argv.includes('--no-build');
const KEEP = process.argv.includes('--keep');
const PORT = process.env.ATLAS_SHOTS_PORT
	? Number(process.env.ATLAS_SHOTS_PORT)
	: await freePort();
const CDP_PORT = process.env.ATLAS_SHOTS_CDP_PORT
	? Number(process.env.ATLAS_SHOTS_CDP_PORT)
	: await freePort();
const CHROME =
	process.env.ATLAS_CHROME ??
	[
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
		'/usr/bin/google-chrome',
		'/usr/bin/chromium',
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
	].find((candidate) => candidate && existsSyncSafe(candidate));

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

/** Capturas publicadas. A ordem casa com a galeria do README. */
const SHOTS = [
	{
		id: 'time-desktop',
		tab: 3,
		viewport: 'desktop',
		width: 1440,
		height: 900,
		wait: '.tp-prototype'
	},
	{
		id: 'notes-desktop',
		tab: 4,
		viewport: 'desktop',
		width: 1440,
		height: 900,
		wait: '.nt-prototype',
		after: `
			await until('.nt-fo[data-folder="demo-folder-diario"]');
			const folder = document.querySelector('.nt-fo[data-folder="demo-folder-diario"]');
			if (!folder) throw new Error('pasta de exemplo não encontrada');
			folder.click();
			await until('.nt-row-main');
			const row = document.querySelector('.nt-row-main');
			if (!row) throw new Error('nenhuma nota na lista: ' + (document.querySelector('.nt-prototype')?.innerText ?? 'sem view').slice(0, 240));
			row.click();
			const opened = await until('.nt-ed.on');
			if (!opened) throw new Error('editor não abriu');
			const split = document.querySelectorAll('.nt-ed .nt-seg button')[2];
			if (!split) throw new Error('botão Split não encontrado');
			split.click();
			await until('.nt-ed .nt-pa[data-m="split"]');
			await sleep(500);
		`
	},
	{
		id: 'finance-desktop',
		tab: 1,
		viewport: 'desktop',
		width: 1440,
		height: 900,
		wait: '.fin-prototype'
	},
	{
		id: 'dashboard-mobile',
		tab: 'dashboard-mobile',
		viewport: 'mobile',
		width: 390,
		height: 844,
		wait: '.dash-prototype'
	},
	{
		id: 'habits-mobile',
		tab: 'habits-mobile',
		viewport: 'mobile',
		width: 390,
		height: 844,
		wait: '.habit-prototype'
	}
];

const HYGIENE = `
	(() => {
		const style = document.createElement('style');
		style.dataset.atlasShots = '1';
		style.textContent = \`
			*, *::before, *::after {
				animation: none !important;
				transition: none !important;
				scrollbar-width: none !important;
			}
			::-webkit-scrollbar { display: none !important; }
			.fin-dev, .toast, .pause-banner { display: none !important; }
			#mm, #qm, #ov, .nt-menu-ov, .nt-ov { display: none !important; }
		\`;
		document.head.append(style);
		document.activeElement?.blur?.();
		window.scrollTo(0, 0);
		document.querySelector('main.workspace')?.scrollTo?.(0, 0);
		// O planejador nasce rolado até a hora atual; para a captura, começa às 9h.
		document.querySelector('.tp-scroll')?.scrollTo?.(0, 112);
		return true;
	})()
`;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* ------------------------------------------------------------------ */
/* Argumentos e build                                                  */
/* ------------------------------------------------------------------ */

function argValue(name, fallback) {
	const hit = process.argv.slice(2).find((item) => item.startsWith(`--${name}=`));
	return hit ? hit.slice(name.length + 3) : fallback;
}

function freePort() {
	return new Promise((done, fail) => {
		const probe = createServer();
		probe.once('error', fail);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address();
			probe.close(() => done(port));
		});
	});
}

function existsSyncSafe(path) {
	try {
		return existsSync(path);
	} catch {
		return false;
	}
}

async function newestMtime(input) {
	let newest = 0;
	try {
		const info = await stat(input);
		if (info.isFile()) return info.mtimeMs;
		for (const entry of await readdir(input, { withFileTypes: true })) {
			if (entry.name === 'node_modules' || entry.name === '.svelte-kit' || entry.name === 'build') {
				continue;
			}
			newest = Math.max(newest, await newestMtime(join(input, entry.name)));
		}
	} catch {
		/* caminho opcional */
	}
	return newest;
}

async function ensureBuild() {
	if (NO_BUILD) return;
	let built = 0;
	try {
		built = (await stat(join(DIST, 'index.html'))).mtimeMs;
	} catch {
		built = 0;
	}
	const sources = [
		join(ROOT, 'src'),
		join(ROOT, 'messages'),
		join(ROOT, 'static'),
		join(ROOT, 'project.inlang'),
		join(ROOT, 'vite.config.ts'),
		join(ROOT, 'package.json')
	];
	let newest = 0;
	for (const source of sources) newest = Math.max(newest, await newestMtime(source));
	if (built && built >= newest) {
		console.log('build/ atualizado, pulando npm run build');
		return;
	}
	console.log('build/ desatualizado — rodando npm run build…');
	await new Promise((done, fail) => {
		const child = spawn('npm', ['run', 'build'], {
			cwd: ROOT,
			stdio: 'inherit',
			shell: process.platform === 'win32'
		});
		child.on('error', fail);
		child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`npm run build saiu com ${code}`))));
	});
}

/* ------------------------------------------------------------------ */
/* Servidor estático + páginas de banner/logo                          */
/* ------------------------------------------------------------------ */

const FONTS = {
	'bricolage-grotesque-latin-800-normal.woff2': join(
		ROOT,
		'node_modules/@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-800-normal.woff2'
	),
	'manrope-latin-800-normal.woff2': join(
		ROOT,
		'node_modules/@fontsource/manrope/files/manrope-latin-800-normal.woff2'
	)
};

function bannerHtml(timeBase64, habitsBase64) {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
	@font-face {
		font-family: 'Bricolage Grotesque';
		font-weight: 800;
		src: url('/__fonts/bricolage-grotesque-latin-800-normal.woff2') format('woff2');
	}
	* { box-sizing: border-box; }
	html, body { width: 1600px; height: 640px; margin: 0; overflow: hidden; background: #101311; }
	body { position: relative; font-family: 'Bricolage Grotesque', sans-serif; }
	.glow {
		position: absolute; inset: 0;
		background:
			radial-gradient(760px 380px at 22% 22%, #d4f25a22, transparent 68%),
			radial-gradient(620px 340px at 82% 78%, #9cc8ff1c, transparent 70%);
	}
	.desk, .phone { position: absolute; overflow: hidden; border: 1px solid #ffffff14; background: #161a16; }
	.desk { left: -90px; top: -58px; width: 1120px; border-radius: 24px; box-shadow: 0 30px 90px #0007; }
	.phone { right: 64px; bottom: -96px; width: 360px; border-radius: 34px; box-shadow: 0 30px 90px #0009; }
	.desk img, .phone img { display: block; width: 100%; filter: blur(10px) saturate(1.08); opacity: .96; }
	.veil { position: absolute; inset: 0; background: linear-gradient(180deg, #0a0c0a73, #0a0c0a80); }
	.mark {
		position: absolute; inset: 0; display: grid; place-items: center;
		color: #d4f25a; font-size: 188px; font-weight: 800; letter-spacing: -.055em;
		text-shadow: 0 0 90px #d4f25a4d, 0 2px 0 #00000033;
	}
</style>
</head>
<body>
	<div class="glow"></div>
	<div class="desk"><img alt="" src="data:image/png;base64,${timeBase64}"></div>
	<div class="phone"><img alt="" src="data:image/png;base64,${habitsBase64}"></div>
	<div class="veil"></div>
	<div class="mark">Atlas</div>
</body>
</html>`;
}

function logoHtml() {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
	@font-face {
		font-family: 'Manrope';
		font-weight: 800;
		src: url('/__fonts/manrope-latin-800-normal.woff2') format('woff2');
	}
	* { box-sizing: border-box; }
	html, body { width: 512px; height: 512px; margin: 0; background: transparent; }
	.tile {
		width: 512px; height: 512px; display: grid; place-items: center;
		border-radius: 116px; background: #d4f25a;
	}
	.glyph {
		font-family: 'Manrope', sans-serif; font-weight: 800; font-size: 356px;
		line-height: 1; letter-spacing: -.085em; color: #20271a;
		transform: translate(-4px, 8px);
	}
</style>
</head>
<body><div class="tile"><div class="glyph">A</div></div></body>
</html>`;
}

let bannerPayload = null;

async function startServer() {
	const server = createServer(async (request, response) => {
		try {
			const pathname = decodeURIComponent(new URL(request.url, `http://127.0.0.1:${PORT}`).pathname);
			if (pathname === '/__banner') {
				if (!bannerPayload) throw new Error('banner sem capturas');
				response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
				response.end(bannerPayload());
				return;
			}
			if (pathname === '/__logo') {
				response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
				response.end(logoHtml());
				return;
			}
			if (pathname.startsWith('/__fonts/')) {
				const file = FONTS[pathname.slice('/__fonts/'.length)];
				if (!file) throw new Error('fonte desconhecida');
				response.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'no-store' });
				response.end(await readFile(file));
				return;
			}
			let file = join(DIST, pathname === '/' ? 'index.html' : pathname);
			try {
				if (!(await stat(file)).isFile()) throw new Error('não é arquivo');
			} catch {
				file = join(DIST, 'index.html'); // fallback do SPA
			}
			response.writeHead(200, {
				'content-type': MIME[extname(file)] ?? 'application/octet-stream',
				'cache-control': 'no-store'
			});
			response.end(await readFile(file));
		} catch (error) {
			response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
			response.end(String(error));
		}
	});
	await new Promise((done, fail) => {
		server.once('error', fail);
		server.listen(PORT, '127.0.0.1', done);
	});
	return server;
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
	for (let attempt = 0; attempt < 80; attempt += 1) {
		try {
			await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
			return child;
		} catch {
			await sleep(150);
		}
	}
	child.kill();
	throw new Error('Chrome não abriu a porta de depuração (defina ATLAS_CHROME)');
}

async function connect() {
	const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((response) => response.json());
	const page = targets.find((target) => target.type === 'page');
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
	await new Promise((done, fail) => {
		socket.addEventListener('open', done, { once: true });
		socket.addEventListener('error', fail, { once: true });
	});

	function send(method, params = {}) {
		const id = ++nextId;
		socket.send(JSON.stringify({ id, method, params }));
		return new Promise((done) => pending.set(id, done));
	}

	async function evaluate(expression) {
		const result = await send('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true
		});
		if (result.error) throw new Error(result.error.message);
		const details = result.result?.exceptionDetails;
		if (details) throw new Error(details.exception?.description ?? details.text);
		return result.result?.result?.value;
	}

	return { socket, send, evaluate };
}

async function until(evaluate, expression, timeout = 15000) {
	const started = Date.now();
	while (Date.now() - started < timeout) {
		try {
			if (await evaluate(expression)) return true;
		} catch {
			/* documento ainda navegando */
		}
		await sleep(120);
	}
	return false;
}

/** Script injetado antes de qualquer documento: modo de teste + inglês. */
const BOOT = `
	try {
		localStorage.setItem('atlas-test-mode', '1');
		localStorage.setItem('atlas.locale.mode', 'en');
	} catch {}
`;

async function capture({ send, evaluate }, shot, base) {
	await send('Emulation.setDeviceMetricsOverride', {
		width: shot.width,
		height: shot.height,
		deviceScaleFactor: 2,
		mobile: shot.viewport === 'mobile'
	});
	await send('Emulation.setTouchEmulationEnabled',
		shot.viewport === 'mobile' ? { enabled: true, maxTouchPoints: 5 } : { enabled: false }
	);
	await send('Page.navigate', { url: base });
	const ready = await until(evaluate, `Boolean(document.querySelector('.app-shell'))`);
	if (!ready) throw new Error(`app não montou em ${shot.id}`);

	await sleep(900);
	if (shot.viewport === 'desktop' && typeof shot.tab === 'number') {
		const clicked = await evaluate(`(() => {
			const nav = document.querySelectorAll('#sb nav.nv')[0];
			const button = nav?.querySelectorAll('button.si')[${shot.tab}];
			if (!button) return false;
			button.click();
			return true;
		})()`);
		if (!clicked) throw new Error(`aba ${shot.tab} não encontrada em ${shot.id}`);
	}
	if (shot.tab === 'habits-mobile') {
		const clicked = await evaluate(`(() => {
			const button = document.querySelector('#bn button:nth-of-type(2)');
			if (!button) return false;
			button.click();
			return true;
		})()`);
		if (!clicked) throw new Error('aba Hábitos não encontrada');
	}

	const arrived = await until(evaluate, `Boolean(document.querySelector('${shot.wait}'))`);
	if (!arrived) throw new Error(`${shot.wait} não apareceu em ${shot.id}`);

	if (shot.after) {
		const helpers = `
			const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
			const until = async (selector) => {
				const started = Date.now();
				while (Date.now() - started < 8000) {
					if (document.querySelector(selector)) return true;
					await sleep(120);
				}
				return false;
			};
		`;
		await evaluate(`(async () => { ${helpers} ${shot.after} })()`);
	}

	await evaluate(HYGIENE);
	await evaluate(`(async () => {
		await document.fonts.ready;
		await new Promise((done) => setTimeout(done, 350));
		return true;
	})()`);

	const screenshot = await send('Page.captureScreenshot', {
		format: 'png',
		fromSurface: true,
		captureBeyondViewport: false
	});
	if (!screenshot.result?.data) throw new Error(`captura vazia em ${shot.id}`);
	await writeFile(join(OUT, `${shot.id}.png`), Buffer.from(screenshot.result.data, 'base64'));
	console.log(`  ✓ ${shot.id}.png (${shot.width * 2}×${shot.height * 2})`);
}

async function makeBanner({ send, evaluate }, base) {
	const time = (await readFile(join(OUT, 'time-desktop.png'))).toString('base64');
	const habits = (await readFile(join(OUT, 'habits-mobile.png'))).toString('base64');
	bannerPayload = () => bannerHtml(time, habits);

	await send('Emulation.setDeviceMetricsOverride', {
		width: 1600,
		height: 640,
		deviceScaleFactor: 1,
		mobile: false
	});
	await send('Emulation.setTouchEmulationEnabled', { enabled: false });
	await send('Page.navigate', { url: `${base}__banner` });
	await until(evaluate, `Boolean(document.querySelector('.mark'))`);
	await evaluate(`(async () => {
		await document.fonts.ready;
		await Promise.all([...document.images].map((image) => image.decode?.().catch(() => null)));
		await new Promise((done) => setTimeout(done, 250));
		return true;
	})()`);
	const screenshot = await send('Page.captureScreenshot', {
		format: 'png',
		fromSurface: true,
		captureBeyondViewport: false
	});
	if (!screenshot.result?.data) throw new Error('banner vazio');
	await writeFile(join(OUT, 'banner.png'), Buffer.from(screenshot.result.data, 'base64'));
	console.log('  ✓ banner.png (1600×640)');
}

async function makeLogo({ send, evaluate }, base) {
	await send('Emulation.setDeviceMetricsOverride', {
		width: 512,
		height: 512,
		deviceScaleFactor: 1,
		mobile: false
	});
	await send('Emulation.setTouchEmulationEnabled', { enabled: false });
	await send('Emulation.setDefaultBackgroundColorOverride', {
		color: { r: 0, g: 0, b: 0, a: 0 }
	});
	await send('Page.navigate', { url: `${base}__logo` });
	await until(evaluate, `Boolean(document.querySelector('.tile'))`);
	await evaluate('(async () => { await document.fonts.ready; return true; })()');
	const screenshot = await send('Page.captureScreenshot', {
		format: 'png',
		fromSurface: true,
		captureBeyondViewport: false,
		omitBackground: true,
		clip: { x: 0, y: 0, width: 512, height: 512, scale: 1 }
	});
	await send('Emulation.setDefaultBackgroundColorOverride', {});
	if (!screenshot.result?.data) throw new Error('logo vazio');
	await writeFile(join(OUT, 'logo.png'), Buffer.from(screenshot.result.data, 'base64'));
	console.log('  ✓ logo.png (512×512)');
}

/* ------------------------------------------------------------------ */
/* Execução                                                            */
/* ------------------------------------------------------------------ */

async function main() {
	if (!CHROME) throw new Error('Chrome não encontrado; defina ATLAS_CHROME');
	await ensureBuild();
	await mkdir(OUT, { recursive: true });

	const selected = SHOTS.filter((shot) => !ONLY.length || ONLY.includes(shot.id.replace(/-.*$/, '')) || ONLY.includes(shot.id));
	if (!selected.length) throw new Error(`nenhuma captura casa com --only=${ONLY.join(',')}`);
	const fullSet = selected.length === SHOTS.length;

	const profile = await mkdtemp(join(tmpdir(), 'atlas-shots-'));
	const server = await startServer();
	const base = `http://127.0.0.1:${PORT}/`;
	console.log(`servindo ${base} · CDP ${CDP_PORT} · chrome ${CHROME}`);
	let chrome;
	try {
		chrome = await launchChrome(profile);
		const page = await connect();
		await page.send('Page.enable');
		await page.send('Runtime.enable');
		await page.send('Page.addScriptToEvaluateOnNewDocument', { source: BOOT });

		console.log(`capturando em ${OUT}`);
		for (const shot of selected) await capture(page, shot, base);

		if (fullSet) {
			console.log('compondo banner e logo');
			await makeBanner(page, base);
			await makeLogo(page, base);
		} else {
			console.log('seleção parcial: banner/logo não gerados');
		}
	} finally {
		chrome?.kill();
		server.closeAllConnections?.();
		await new Promise((done) => server.close(done));
		if (KEEP) {
			console.log(`perfil mantido em ${profile}`);
		} else {
			// O Chrome ainda pode estar gravando o perfil; tenta de novo e não
			// deixa a limpeza mascarar o erro real da captura.
			for (let attempt = 0; attempt < 4; attempt += 1) {
				try {
					await rm(profile, { recursive: true, force: true });
					break;
				} catch {
					await sleep(400);
				}
			}
		}
	}
}

main().catch((error) => {
	console.error(`falhou: ${error.message}`);
	process.exitCode = 1;
});
