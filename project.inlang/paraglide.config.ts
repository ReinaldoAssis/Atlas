import { defineConfig } from '@inlang/paraglide-js';

/**
 * Atlas é um SPA estático (Tauri + build web) com dois idiomas.
 *
 * A escolha do usuário vive no `localStorage` (sem URL e sem cookie); o
 * idioma do sistema é só o palpite inicial. `baseLocale` continua pt-BR, mas a
 * resolução inicial em `src/lib/i18n/locale.svelte.ts` força **en** quando o
 * sistema não é pt nem en — pt-BR só entra quando o aparelho está em português.
 */
export default defineConfig({
	outdir: './src/lib/paraglide',
	strategy: ['localStorage', 'preferredLanguage', 'baseLocale'],
	emitTsDeclarations: true
});
