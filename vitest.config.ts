import { defineConfig } from 'vitest/config';

// Testes unitários das funções puras de `src/lib`.
// Não carrega o plugin do SvelteKit de propósito: os alvos são módulos TS
// (atlas, notas, grafo) sem dependência de `$app`/`$env`.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
