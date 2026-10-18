/** Modelo normalizado da lista de lançamentos de hábito/tracker. */

export interface HistoryRow {
	id: string;
	value: string;
	/** Hora ou rótulo curto à direita (opcional). */
	meta?: string;
	note?: string;
	tone?: 'ok' | 'bad' | null;
}

export interface HistoryGroup {
	date: string;
	rows: HistoryRow[];
}
