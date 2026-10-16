import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { fileURLToPath } from 'node:url';

/**
 * Dois projetos:
 *
 * - `unit`: funções puras de `src/lib` (node). Não carrega o plugin do
 *   Svelte de propósito: os alvos não dependem de `$app`/`$env`.
 * - `components`: componentes do kit no jsdom (`*.svelte.test.ts`), com o
 *   build de browser do Svelte (`svelteTesting`).
 */
export default defineConfig({
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
