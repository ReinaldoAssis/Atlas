import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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

/**
 * Dois projetos:
 *
 * - `unit`: funções puras de `src/lib` (node). Não carrega o plugin do
 *   Svelte de propósito: os alvos não dependem de `$app`/`$env`.
 * - `components`: componentes do kit no jsdom (`*.svelte.test.ts`), com o
 *   build de browser do Svelte (`svelteTesting`).
 */
export default defineConfig({
	define: {
		__ATLAS_VERSION__: JSON.stringify(appVersion),
		__ATLAS_COMMIT__: JSON.stringify(commit)
	},
	test: {
		projects: [
			{
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.test.ts'],
					exclude: ['src/**/*.svelte.test.ts']
				}
			},
			{
				plugins: [svelte({ compilerOptions: { runes: true } }), svelteTesting()],
				resolve: {
					alias: { '#lib': fileURLToPath(new URL('./src/lib', import.meta.url)) }
				},
				test: {
					name: 'components',
					environment: 'jsdom',
					include: ['src/**/*.svelte.test.ts'],
					setupFiles: ['./vitest-setup.ts']
				}
			}
		]
	}
});
