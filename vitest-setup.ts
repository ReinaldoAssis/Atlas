import { cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach } from 'vitest';
import { setLocale } from './src/lib/paraglide/runtime.js';

// Cada teste monta o componente e limpa o DOM depois.
afterEach(cleanup);

// O jsdom anuncia `en-US`; os testes de componente afirmam a copy em pt-BR.
// Fixar o locale aqui mantém o esperado sem depender do idioma da máquina.
beforeEach(() => {
	setLocale('pt-BR', { reload: false });
});
