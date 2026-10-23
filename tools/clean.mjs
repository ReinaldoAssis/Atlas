#!/usr/bin/env node
/**
 * Limpa caches de build do Atlas e caches de toolchain.
 *
 * Uso:
 *   npm run clean                    # TUI: setas, espaço, enter
 *   npm run clean -- --list          # só lista os alvos e tamanhos
 *   npm run clean -- --dry-run       # mostra o plano sem apagar
 *   npm run clean -- --yes           # não pede confirmação
 *   npm run clean -- --only=rust-target,gradle-caches
 *   npm run clean -- --json          # lista em JSON (para automação)
 *
 * Regras de segurança:
 * - só apaga caminhos desta lista fixa;
 * - recusa qualquer alvo que seja a home, a raiz do repo ou ancestral deles;
 * - nunca segue symlink: apaga o link, não o destino;
 * - `--dry-run` mede e lista, sem tocar em nada.
 */
import { existsSync, statfsSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir, platform as osPlatform } from 'node:os';
import { join, resolve, sep } from 'node:path';
import readline from 'node:readline/promises';

const ROOT = resolve(import.meta.dirname, '..');
const HOME = homedir();
const OS = osPlatform();
const IS_WINDOWS = OS === 'win32';
const DU_PROBE = IS_WINDOWS ? { error: new Error('no du') } : spawnSync('du', ['-sk', import.meta.dirname]);
const HAS_DU = !DU_PROBE.error && DU_PROBE.status === 0;

/** Alvos por plataforma. `note` aparece na TUI ao lado do tamanho. */
export function targets({ root = ROOT, home = HOME, os = OS } = {}) {
	const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
	const cacheDir =
		os === 'darwin' ? join(home, 'Library', 'Caches') : join(home, '.cache');

	const list = [
		{
			id: 'rust-target',
			label: 'Rust target/ (debug, release, iOS, Android, Windows)',
			group: 'Projeto',
			path: join(root, 'src-tauri', 'target'),
			note: 'rebuild Rust custa 10–40 min'
		},
		{
			id: 'svelte-kit',
			label: 'SvelteKit .svelte-kit',
			group: 'Projeto',
			path: join(root, '.svelte-kit'),
			note: 'regera no próximo dev/build'
		},
		{
			id: 'svelte-build',
			label: 'Build estático build/',
			group: 'Projeto',
			path: join(root, 'build'),
			note: 'regera no próximo build'
		},
		{
			id: 'android-build',
			label: 'Android Gradle build/ (apk, aab, intermediates)',
			group: 'Projeto',
			path: join(root, 'src-tauri', 'gen', 'android', 'app', 'build'),
			note: 'regera no próximo android:build'
		},
		{
			id: 'android-gradle-root',
			label: 'Android Gradle build/ da raiz e buildSrc',
			group: 'Projeto',
			path: join(root, 'src-tauri', 'gen', 'android', 'build'),
			note: 'cache de configuração do Gradle'
		},
		{
			id: 'apple-build',
			label: 'Xcode build/ do gen/apple',
			group: 'Projeto',
			path: join(root, 'src-tauri', 'gen', 'apple', 'build'),
			note: 'regera no próximo ios:build'
		},
		{
			id: 'node-modules',
			label: 'node_modules',
			group: 'Projeto',
			path: join(root, 'node_modules'),
			note: 'reinstalar com npm ci',
			preselect: false
		},
		{
			id: 'gradle-caches',
			label: 'Gradle caches (~/.gradle/caches)',
			group: 'Toolchain',
			path: join(home, '.gradle', 'caches'),
			note: 'Gradle baixa de novo'
		},
		{
			id: 'gradle-wrapper',
			label: 'Gradle wrapper distributions',
			group: 'Toolchain',
			path: join(home, '.gradle', 'wrapper'),
			note: 'baixa a distribuição de novo'
		},
		{
			id: 'cargo-registry',
			label: 'Cargo registry (~/.cargo/registry)',
			group: 'Toolchain',
			path: join(home, '.cargo', 'registry'),
			note: 'cargo refaz o download'
		},
		{
			id: 'cargo-git',
			label: 'Cargo git checkouts (~/.cargo/git)',
			group: 'Toolchain',
			path: join(home, '.cargo', 'git'),
			note: 'cargo refaz o clone'
		},
		{
			id: 'npm-cache',
			label: 'npm cache (~/.npm/_cacache)',
			group: 'Toolchain',
			path: join(home, '.npm', '_cacache'),
			note: 'npm baixa de novo'
		},
		{
			id: 'pnpm-store',
			label: 'pnpm store',
			group: 'Toolchain',
			path:
				os === 'darwin'
					? join(home, 'Library', 'pnpm', 'store')
					: os === 'win32'
						? join(localAppData, 'pnpm', 'store')
						: join(home, '.local', 'share', 'pnpm', 'store'),
			note: 'pnpm baixa de novo'
		},
		{
			id: 'playwright-browsers',
			label: 'Playwright browsers',
			group: 'Toolchain',
			path:
				os === 'darwin'
					? join(cacheDir, 'ms-playwright')
					: os === 'win32'
						? join(localAppData, 'ms-playwright')
						: join(cacheDir, 'ms-playwright'),
			note: 'npx playwright install baixa de novo'
		},
		{
			id: 'xcode-derived',
			label: 'Xcode DerivedData',
			group: 'Toolchain',
			path: join(home, 'Library', 'Developer', 'Xcode', 'DerivedData'),
			platforms: ['darwin'],
			note: 'Xcode recompila'
		},
		{
			id: 'xcode-devicesupport',
			label: 'Xcode iOS DeviceSupport',
			group: 'Toolchain',
			path: join(home, 'Library', 'Developer', 'Xcode', 'iOS DeviceSupport'),
			platforms: ['darwin'],
			note: 'regera ao plugar o device'
		},
		{
			id: 'coresim-devices',
			label: 'CoreSimulator Devices',
			group: 'Toolchain',
			path: join(home, 'Library', 'Developer', 'CoreSimulator', 'Devices'),
			platforms: ['darwin'],
			note: 'perde apps/dados dos simuladores'
		},
		{
			id: 'brew-cache',
			label: 'Homebrew download cache',
			group: 'Toolchain',
			path: join(cacheDir, 'Homebrew'),
			platforms: ['darwin'],
			note: 'brew baixa de novo'
		}
	];

	return list
		.filter((target) => !target.platforms || target.platforms.includes(os))
		.map((target) => ({ preselect: true, ...target }));
}

export function humanBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	const digits = unit === 0 ? 0 : value < 10 ? 1 : 0;
	return `${value.toFixed(digits)} ${units[unit]}`;
}

/**
 * Só permite apagar dentro do repo ou da home, e nunca a própria home, o repo
 * ou um ancestral deles.
 */
export function assertDeletable(candidate, { root = ROOT, home = HOME } = {}) {
	const target = resolve(candidate);
	const protect = [resolve(root), resolve(home), resolve(sep)];
	for (const guarded of protect) {
		if (target === guarded) throw new Error(`recusado: ${target} é um caminho protegido`);
		if (guarded.startsWith(target + sep)) {
			throw new Error(`recusado: ${target} contém ${guarded}`);
		}
	}
	const inside = (base) => target === base || target.startsWith(base + sep);
	if (!inside(resolve(root)) && !inside(resolve(home))) {
		throw new Error(`recusado: ${target} está fora do repo e da home`);
	}
	return target;
}

/** `du -sk` é muito mais rápido que percorrer a árvore em JS. */
function measureWithDu(target) {
	const result = spawnSync('du', ['-sk', target], { encoding: 'utf8' });
	if (result.status !== 0) return null;
	const kb = Number(result.stdout.trim().split(/\s+/)[0]);
	return Number.isFinite(kb) ? kb * 1024 : null;
}

async function measureWalk(target) {
	let total = 0;
	const stack = [target];
	while (stack.length > 0) {
		const current = stack.pop();
		let entries;
		try {
			entries = await readdir(current, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(current, entry.name);
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) {
				stack.push(full);
				continue;
			}
			try {
				const info = await stat(full);
				total += info.size;
			} catch {
				// arquivo sumiu entre o readdir e o stat
			}
		}
	}
	return total;
}

export async function measure(target) {
	if (!existsSync(target)) return null;
	if (HAS_DU) {
		const size = measureWithDu(target);
		if (size !== null) return size;
	}
	return measureWalk(target);
}

function freeSpace(target) {
	try {
		const stats = statfsSync(target);
		return stats.bavail * stats.bsize;
	} catch {
		return null;
	}
}

function parseArgs(argv) {
	const flags = { dryRun: false, yes: false, list: false, json: false, only: null, help: false };
	for (const arg of argv) {
		if (arg === '--dry-run' || arg === '-n') flags.dryRun = true;
		else if (arg === '--yes' || arg === '-y') flags.yes = true;
		else if (arg === '--list' || arg === '-l') flags.list = true;
		else if (arg === '--json') flags.json = true;
		else if (arg === '--help' || arg === '-h') flags.help = true;
		else if (arg.startsWith('--only=')) {
			flags.only = arg
				.slice('--only='.length)
				.split(',')
				.map((value) => value.trim())
				.filter(Boolean);
		} else {
			throw new Error(`argumento desconhecido: ${arg}`);
		}
	}
	return flags;
}

const HELP = `Limpa caches de build do Atlas e caches de toolchain.

Uso: npm run clean -- [opções]

  (sem opções)        TUI: ↑/↓ move, espaço marca, a alterna tudo, enter confirma
  -l, --list          lista os alvos existentes e seus tamanhos
      --json          lista em JSON
  -n, --dry-run       mostra o plano e não apaga nada
  -y, --yes           não pede confirmação
      --only=id,id    limita a execução a estes alvos
  -h, --help          esta ajuda

Só apaga caminhos da lista fixa do script. Nunca toca em dados do app, secrets
ou na home.`;

function printTargets(rows) {
	console.log('\nAlvos encontrados:\n');
	let group = null;
	for (const row of rows) {
		if (row.group !== group) {
			group = row.group;
			console.log(`  ${group}`);
		}
		const size = row.size === null ? '—' : humanBytes(row.size);
		console.log(`    ${row.id.padEnd(22)} ${size.padStart(9)}  ${row.label}`);
		if (row.note) console.log(`    ${' '.repeat(22)} ${' '.repeat(9)}  ↳ ${row.note}`);
	}
	console.log('');
}

function render(state, rows) {
	const lines = [];
	lines.push('\x1b[1mAtlas — limpar caches\x1b[0m');
	lines.push('\x1b[2m↑/↓ move · espaço marca · a alterna tudo · enter confirma · q sai\x1b[0m');
	lines.push('');

	let group = null;
	rows.forEach((row, index) => {
		if (row.group !== group) {
			group = row.group;
			if (index > 0) lines.push('');
			lines.push(`\x1b[1m  ${group}\x1b[0m`);
		}
		const cursor = index === state.cursor ? '\x1b[36m›\x1b[0m' : ' ';
		const box = row.selected ? '\x1b[32m[x]\x1b[0m' : '[ ]';
		const size = row.size === null ? '—' : humanBytes(row.size);
		const dim = row.selected ? '' : '\x1b[2m';
		lines.push(
			`${cursor} ${box} ${dim}${row.label.padEnd(52)}\x1b[0m ${size.padStart(9)}`
		);
		if (index === state.cursor) {
			const parts = [];
			if (row.note) parts.push(row.note);
			parts.push(row.path);
			lines.push(`     \x1b[2m${parts.join(' · ')}\x1b[0m`);
		}
	});

	const selected = rows.filter((row) => row.selected);
	const total = selected.reduce((sum, row) => sum + (row.size ?? 0), 0);
	const free = freeSpace(ROOT);
	lines.push('');
	lines.push(
		`  ${selected.length} de ${rows.length} selecionados · \x1b[1m${humanBytes(total)}\x1b[0m` +
			(free === null ? '' : ` · livre agora: ${humanBytes(free)}`)
	);
	lines.push('');
	return lines.join('\n');
}

function clear() {
	process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
}

function readKeys(onKey) {
	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.setEncoding('utf8');
	const handler = (chunk) => onKey(chunk);
	process.stdin.on('data', handler);
	return () => {
		process.stdin.off('data', handler);
		if (process.stdin.isTTY) process.stdin.setRawMode(false);
		process.stdin.pause();
	};
}

/**
 * Reducer de teclas da TUI. Puro para poder ser testado sem terminal:
 * devolve 'abort', 'confirm' ou 'redraw'.
 */
export function applyKey(state, rows, key) {
	if (key.includes('\u0003') || key === 'q' || key === 'Q') return 'abort';
	if (key.includes('\u001b[A') || key === 'k') {
		state.cursor = (state.cursor - 1 + rows.length) % rows.length;
	} else if (key.includes('\u001b[B') || key === 'j') {
		state.cursor = (state.cursor + 1) % rows.length;
	} else if (key === ' ') {
		const row = rows[state.cursor];
		row.selected = !row.selected;
	} else if (key === 'a' || key === 'A') {
		const allSelected = rows.every((row) => row.selected);
		rows.forEach((row) => {
			row.selected = !allSelected;
		});
	} else if (key === '\r' || key === '\n') {
		return 'confirm';
	}
	return 'redraw';
}

async function select(rows) {
	if (!process.stdin.isTTY || !process.stdout.isTTY) return null;

	const state = { cursor: 0 };

	return new Promise((resolveSelection) => {
		let cleanup = () => {};
		const draw = () => {
			clear();
			process.stdout.write(render(state, rows));
		};

		const finish = (value) => {
			cleanup();
			clear();
			resolveSelection(value);
		};

		const onKey = (key) => {
			const action = applyKey(state, rows, key);
			if (action === 'abort') return finish(null);
			if (action === 'confirm') return finish(rows.filter((row) => row.selected));
			draw();
		};

		cleanup = readKeys(onKey);
		draw();
	});
}

async function confirm(question) {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = await rl.question(question);
		return /^(s|sim|y|yes)$/i.test(answer.trim());
	} finally {
		rl.close();
	}
}

function describeFailure(error) {
	const code = error && typeof error === 'object' ? error.code : null;
	if (code === 'EBUSY') return 'arquivo em uso (feche o app/build e tente de novo)';
	if (code === 'EACCES' || code === 'EPERM') return 'sem permissão';
	return error instanceof Error ? error.message : String(error);
}

async function main() {
	let flags;
	try {
		flags = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`clean: ${error.message}\n`);
		console.log(HELP);
		process.exitCode = 1;
		return;
	}

	if (flags.help) {
		console.log(HELP);
		return;
	}

	const all = targets();
	const rows = [];
	for (const target of all) {
		if (flags.only && !flags.only.includes(target.id)) continue;
		const path = resolve(target.path);
		const size = await measure(path);
		if (size === null) continue;
		rows.push({ ...target, path, size, selected: target.preselect !== false });
	}

	if (flags.only) {
		const known = new Set(all.map((row) => row.id));
		const unknown = flags.only.filter((id) => !known.has(id));
		if (unknown.length > 0) console.error(`clean: alvo desconhecido: ${unknown.join(', ')}`);
	}

	if (rows.length === 0) {
		console.log('Nada para limpar: nenhum alvo existe nesta máquina.');
		return;
	}

	if (flags.json) {
		console.log(
			JSON.stringify(
				rows.map(({ id, label, group, path, size, note }) => ({
					id,
					label,
					group,
					path,
					size,
					note
				})),
				null,
				2
			)
		);
		return;
	}

	if (flags.list) {
		printTargets(rows);
		return;
	}

	let selected;
	if (flags.only || !process.stdin.isTTY) {
		selected = rows.filter((row) => row.selected);
		if (!process.stdin.isTTY && !flags.yes && !flags.dryRun) {
			console.error(
				'Sem TTY: use --list, --dry-run ou --yes (com --only=id,id para escolher).'
			);
			process.exitCode = 1;
			return;
		}
	} else {
		selected = await select(rows);
		if (!selected) {
			console.log('Cancelado.');
			return;
		}
	}

	if (selected.length === 0) {
		console.log('Nenhum alvo selecionado.');
		return;
	}

	const total = selected.reduce((sum, row) => sum + (row.size ?? 0), 0);
	const before = freeSpace(ROOT);

	console.log('\nPlano:\n');
	for (const row of selected) {
		console.log(`  ${humanBytes(row.size ?? 0).padStart(9)}  ${row.path}`);
		if (row.note) console.log(`  ${' '.repeat(9)}  ↳ ${row.note}`);
	}
	console.log(`\n  total: ${humanBytes(total)}`);
	if (before !== null) console.log(`  livre antes: ${humanBytes(before)}`);

	if (flags.dryRun) {
		console.log('\nDry run: nada foi apagado.');
		return;
	}

	if (!flags.yes) {
		const ok = await confirm('\nApagar estes itens? [s/N] ');
		if (!ok) {
			console.log('Cancelado.');
			return;
		}
	}

	console.log('');
	const failures = [];
	let freed = 0;
	for (const row of selected) {
		try {
			assertDeletable(row.path);
			await rm(row.path, { recursive: true, force: true, maxRetries: 2 });
			freed += row.size ?? 0;
			console.log(`  ok    ${row.id} (${humanBytes(row.size ?? 0)})`);
		} catch (error) {
			failures.push({ id: row.id, error });
			console.log(`  falha ${row.id}: ${describeFailure(error)}`);
		}
	}

	const after = freeSpace(ROOT);
	console.log(`\nRemovido: ${humanBytes(freed)}`);
	if (before !== null && after !== null) {
		console.log(`Livre agora: ${humanBytes(after)} (+${humanBytes(after - before)})`);
	}
	if (failures.length > 0) {
		console.log(`${failures.length} alvo(s) falharam; veja acima.`);
		process.exitCode = 1;
	}
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	main().catch((error) => {
		console.error(error);
		process.exit(1);
	});
}
