/**
 * Atualizações do app empacotado (updater do Tauri sobre GitHub Releases).
 *
 * Decisão travada (`docs/ROADMAP.md`): o updater é **só do Windows** — é a
 * única plataforma com release publicado. No iOS a renovação é pelo SideStore
 * (S9) e o macOS fica fora deste ciclo. Por isso os plugins entram por
 * `import()` dinâmico: o preview web e o shell do iOS não precisam deles.
 *
 * O endpoint (`tauri.conf.json` → `plugins.updater`) aponta para o
 * `latest.json` do release mais recente, publicado por `.github/workflows/
 * release.yml`. A assinatura minisign é obrigatória: o Tauri recusa um
 * pacote sem `.sig` válido contra a `pubkey` do app.
 */
import { isTauri } from '@tauri-apps/api/core';

export interface PendingUpdate {
	version: string;
	notes: string;
	/** Baixa e instala. No Windows o app é encerrado ao instalar. */
	install: (onProgress: (percent: number | null) => void) => Promise<void>;
}

/** `true` quando faz sentido oferecer atualização: app Tauri no Windows. */
export function updaterSupported(tauri: boolean, userAgent: string): boolean {
	return tauri && /Windows/i.test(userAgent);
}

/** Mesmo critério, lendo o ambiente atual (usado pela tela de Configurações). */
export function updaterSupportedHere(): boolean {
	const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
	return updaterSupported(isTauri(), userAgent);
}

/** 0–100, ou `null` quando o servidor não informou o tamanho do pacote. */
export function downloadPercent(downloaded: number, total: number): number | null {
	if (!total || total <= 0) return null;
	return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
}

/** Consulta o endpoint configurado; `null` quando o app já está atualizado. */
export async function checkForUpdate(): Promise<PendingUpdate | null> {
	const { check } = await import('@tauri-apps/plugin-updater');
	const update = await check();
	if (!update) return null;
	return {
		version: update.version,
		notes: (update.body ?? '').trim(),
		install: async (onProgress) => {
			let total = 0;
			let downloaded = 0;
			await update.downloadAndInstall((event) => {
				if (event.event === 'Started') {
					total = event.data.contentLength ?? 0;
					onProgress(downloadPercent(0, total));
				} else if (event.event === 'Progress') {
					downloaded += event.data.chunkLength;
					onProgress(downloadPercent(downloaded, total));
				} else {
					onProgress(100);
				}
			});
		}
	};
}

/** Reabre o app depois de instalar (o instalador do Windows encerra o processo). */
export async function relaunchApp(): Promise<void> {
	const { relaunch } = await import('@tauri-apps/plugin-process');
	await relaunch();
}
