import { cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';

// Cada teste monta o componente e limpa o DOM depois.
afterEach(cleanup);
