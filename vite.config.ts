import { paraglideVitePlugin } from '@inlang/paraglide-js';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Em device físico o Tauri expõe o dev server no endereço da rede local
// (TAURI_DEV_HOST) — o iPhone precisa alcançar esse host, não `localhost`.
const host = process.env.TAURI_DEV_HOST;
const appVersion = readFileSync(new URL('./VERSION', import.meta.url), 'utf8').trim();
const commit = (() => {
	try {
		return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return 'dev';
	}
})();

export default defineConfig({
	clearScreen: false,
	server: {
		host: host || false,
		port: 1420,
		strictPort: true,
		hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined
	},
	define: {
		// Atlas é SPA estática: o highlighter do Carta roda só no cliente.
		__ENABLE_CARTA_SSR_HIGHLIGHTER__: false,
		__ATLAS_VERSION__: JSON.stringify(appVersion),
		__ATLAS_COMMIT__: JSON.stringify(commit)
	},
	plugins: [
		// i18n: pt-BR único por ora. As opções vêm de
		// `project.inlang/paraglide.config.ts` (outdir, strategy).
		paraglideVitePlugin({ project: './project.inlang' }),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({ fallback: 'index.html' })
		})
	]
});
