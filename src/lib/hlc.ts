/**
 * Carimbo de escrita — HLC "lite" (relógio lógico híbrido).
 *
 * O sync P2P resolve conflito por último-a-escrever (`updated_at` maior vence,
 * empate pelo menor `device_id`). Usar `Date.now()` cru quebra quando os
 * relógios dos aparelhos divergem: o aparelho adiantado ganha sempre e engole
 * edição feita depois no outro.
 *
 * A regra aqui é a parte barata de um HLC: o carimbo é o maior entre o relógio
 * local e (maior carimbo já visto + 1). Fica monotônico por instalação, perto do
 * relógio de parede e sempre acima de tudo que já chegou de outro aparelho —
 * então uma edição nunca perde para um carimbo antigo.
 *
 * Sem estado: quem chama guarda `lastSeen` (a instalação guarda em
 * `app_settings.hlc_last`).
 */

/** Próximo carimbo a partir do relógio local e do maior carimbo já visto. */
export function nextStamp(now: number, lastSeen: number): number {
	const wall = Number.isFinite(now) ? Math.trunc(now) : 0;
	const seen = Number.isFinite(lastSeen) ? Math.trunc(lastSeen) : 0;
	return Math.max(wall, seen + 1);
}

/** Incorpora um carimbo visto (de uma linha carregada ou recebida de um par). */
export function observeStamp(lastSeen: number, seen: number): number {
	const current = Number.isFinite(lastSeen) ? Math.trunc(lastSeen) : 0;
	const observed = Number.isFinite(seen) ? Math.trunc(seen) : 0;
	return Math.max(current, observed);
}
