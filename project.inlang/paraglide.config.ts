import { defineConfig } from '@inlang/paraglide-js';

/**
 * Atlas é um SPA estático (Tauri + build web) com um único idioma por ora.
 * `baseLocale` mantém a estratégia sem URL e sem cookie: nada muda entre o
 * documento atual e o build, e não existe rota `/pt-BR/...`.
 */
export default defineConfig({
	outdir: './src/lib/paraglide',
	strategy: ['baseLocale'],
	emitTsDeclarations: true
});
