import type { BackupAttachment, BackupData } from './storage';

/** Resumo do que vem num backup, usado na confirmação do import. */
export interface BackupSummary {
	habits: number;
	trackers: number;
	transactions: number;
	timeBlocks: number;
	notes: number;
	folders: number;
	attachments: number;
}

export function summarizeBackup(data: BackupData, attachments: BackupAttachment[] = []): BackupSummary {
	return {
		habits: data.snapshot.habits.filter((habit) => habit.active).length,
		trackers: (data.snapshot.trackers ?? []).filter((tracker) => tracker.active).length,
		transactions: data.snapshot.transactions.length,
		timeBlocks: data.snapshot.timeBlocks.length,
		notes: data.notes.length,
		folders: data.folders.length,
		attachments: attachments.length
	};
}

function count(value: number, singular: string, plural: string): string {
	return value === 1 ? `1 ${singular}` : `${value} ${plural}`;
}

/** Lista curta em pt-BR: "2 hábitos, 3 notas e 1 anexo". */
export function describeBackup(summary: BackupSummary): string {
	const parts = [
		summary.habits ? count(summary.habits, 'hábito', 'hábitos') : '',
		summary.trackers ? count(summary.trackers, 'tracker', 'trackers') : '',
		summary.transactions ? count(summary.transactions, 'lançamento', 'lançamentos') : '',
		summary.timeBlocks ? count(summary.timeBlocks, 'bloco de tempo', 'blocos de tempo') : '',
		summary.notes ? count(summary.notes, 'nota', 'notas') : '',
		summary.attachments ? count(summary.attachments, 'anexo', 'anexos') : ''
	].filter(Boolean);
	if (!parts.length) return 'nenhum registro';
	if (parts.length === 1) return parts[0];
	return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}
