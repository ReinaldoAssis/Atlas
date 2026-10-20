<script lang="ts">
	import { Bell, CalendarDays, CircleDollarSign, FlaskConical, Keyboard, Volume2, Vibrate, ArrowDownRight, ArrowUpRight, Flame, RefreshCw, Wifi, Link2, Smartphone, Timer } from '@lucide/svelte';
	import type { AtlasSnapshot, FirstDayOfWeek } from '#lib/atlas';
	import { m } from '#lib/paraglide/messages.js';
	import Sheet from '#lib/components/ui/Sheet.svelte';
	import Segmented from '#lib/components/ui/Segmented.svelte';
	import Toggle from '#lib/components/ui/Toggle.svelte';
	import { lastSyncLabel, type SyncPeerStatus, type SyncStatus, type SyncDiscoveryStatus } from '#lib/sync';

	/**
	 * Configurações seguindo `docs/DESIGN.md` §4: sheet com tiles, sem
	 * eyebrow, poucas palavras. Toda a lógica continua no `+page.svelte`;
	 * aqui só mora a apresentação.
	 */
	let {
		snapshot,
		testMode,
		syncAvailable,
		sync,
		syncBusy,
		updaterAvailable,
		updaterBusy,
		updaterStatus,
		notificationsDiagnostics = null,
		onclose,
		onnotifications,
		onpreference,
		oncurrency,
		onfirstday,
		ontestmode,
		onpause,
		onexport,
		onimport,
		oncheckupdates,
		onsynctoggle,
		onsyncnow,
		onsyncdiscoveryrestart,
		onsyncauto,
		onsyncinterval,
		onpair,
		onunpair,
		onnotificationsdiagnostics,
		onnotificationstest
	}: {
		snapshot: AtlasSnapshot;
		testMode: boolean;
		syncAvailable: boolean;
		sync: SyncStatus | null;
		syncBusy: boolean;
		updaterAvailable: boolean;
		updaterBusy: boolean;
		updaterStatus: string;
		notificationsDiagnostics?: NotificationDiagnostics | null;
		onclose: () => void;
		onnotifications: (enabled: boolean) => void;
		onpreference: (
			key: 'soundEnabled' | 'typingSoundEnabled' | 'hapticsEnabled',
			enabled: boolean
		) => void;
		oncurrency: (value: string) => Promise<boolean>;
		onfirstday: (value: FirstDayOfWeek) => void;
		ontestmode: (enabled: boolean) => void;
		onpause: () => void;
		onexport: () => void;
		onimport: () => void;
		oncheckupdates: () => void;
		onsynctoggle: (enabled: boolean) => void;
		onsyncnow: () => void;
		onsyncdiscoveryrestart: () => void;
		onsyncauto: (enabled: boolean) => void;
		onsyncinterval: (secs: number) => void;
		onpair: () => void;
		onunpair: (peer: SyncPeerStatus) => void;
		onnotificationsdiagnostics?: () => void;
		onnotificationstest?: () => void;
	} = $props();

	type NotificationDiagnostics = {
		permission: boolean | null;
		scheduled: number;
		next: string | null;
		error: string | null;
		checkedAt: string | null;
	};

	function diagnosticsWhen(value: string | null): string {
		if (!value) return 'nenhuma';
		return new Date(value).toLocaleString('pt-BR');
	}

	/** Paleta de categorias do guia (`docs/DESIGN.md` §2). */
	async function handleCurrency(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		if (!(await oncurrency(select.value))) select.value = snapshot.preferences.currency;
	}

	function discoveryLabel(status: SyncDiscoveryStatus): string {
		if (status.message) return status.message;
		switch (status.state) {
			case 'starting':
				return m.sync_discovery_starting();
			case 'announcing':
				return m.sync_discovery_announcing();
			case 'browsing':
				return status.found
					? m.sync_discovery_found({ count: status.found })
					: m.sync_discovery_browsing();
			case 'off':
				return m.sync_discovery_off();
			default:
				return m.sync_discovery_error();
		}
	}

	async function openAppSettings() {
		try {
			const { openUrl } = await import('@tauri-apps/plugin-opener');
			await openUrl('app-settings:');
		} catch {
			// Sem o plugin/permissão, a instrução na mensagem continua valendo.
		}
	}

	/** Intervalo do auto-sync: inteiro de 1 a 300 s; valor inválido volta ao atual. */
	function handleInterval(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const current = sync?.intervalSecs ?? 2;
		const value = Math.round(Number(input.value));
		if (!Number.isFinite(value)) {
			input.value = String(current);
			return;
		}
		const clamped = Math.min(300, Math.max(1, value));
		input.value = String(clamped);
		if (clamped !== current) onsyncinterval(clamped);
	}
</script>

<Sheet title={m.settings_title()} closeLabel={m.settings_close()} {onclose}>
	<div class="content">
		<section>
			<h3>{m.settings_section_local()}</h3>
			<div class="tile">
				<div class="row">
					<span class="lead"><Bell size={17} /></span>
					<span class="text">
						<strong>{m.settings_notifications_title()}</strong>
						<small>{m.settings_notifications_hint()}</small>
					</span>
					<Toggle
						label={m.settings_notifications_title()}
						checked={snapshot.preferences.notificationsEnabled}
						onchange={onnotifications}
					/>
				</div>
				<div class="row">
					<span class="lead"><Volume2 size={17} /></span>
					<span class="text">
						<strong>{m.settings_sound_title()}</strong>
						<small>{m.settings_sound_hint()}</small>
					</span>
					<Toggle
						label={m.settings_sound_title()}
						checked={snapshot.preferences.soundEnabled}
						onchange={(checked) => onpreference('soundEnabled', checked)}
					/>
				</div>
				<div class="row">
					<span class="lead"><Keyboard size={17} /></span>
					<span class="text">
						<strong>{m.settings_typing_title()}</strong>
						<small>{m.settings_typing_hint()}</small>
					</span>
					<Toggle
						label={m.settings_typing_title()}
						checked={snapshot.preferences.typingSoundEnabled}
						onchange={(checked) => onpreference('typingSoundEnabled', checked)}
					/>
				</div>
				<div class="row">
					<span class="lead"><Vibrate size={17} /></span>
					<span class="text">
						<strong>{m.settings_haptics_title()}</strong>
						<small>{m.settings_haptics_hint()}</small>
					</span>
					<Toggle
						label={m.settings_haptics_title()}
						checked={snapshot.preferences.hapticsEnabled}
						onchange={(checked) => onpreference('hapticsEnabled', checked)}
					/>
				</div>
				<div class="row">
					<span class="lead"><CircleDollarSign size={17} /></span>
					<span class="text">
						<strong>{m.settings_currency_title()}</strong>
						<small>{m.settings_currency_hint()}</small>
					</span>
					<select
						class="select"
						aria-label={m.settings_currency_title()}
						value={snapshot.preferences.currency}
						onchange={handleCurrency}
					>
						<option value="BRL">BRL · Real</option>
						<option value="USD">USD · Dólar</option>
						<option value="EUR">EUR · Euro</option>
					</select>
				</div>
				<div class="row">
					<span class="lead"><CalendarDays size={17} /></span>
					<span class="text">
						<strong>Primeiro dia da semana</strong>
						<small>Afeta hábito semanal, metas e calendários.</small>
					</span>
					<Segmented
						label="Primeiro dia da semana"
						options={[
							{ value: 'mon', label: 'Seg' },
							{ value: 'sun', label: 'Dom' }
						]}
						value={snapshot.preferences.firstDayOfWeek}
						onchange={(value) => onfirstday(value === 'sun' ? 'sun' : 'mon')}
					/>
				</div>
			</div>
		</section>

		{#if syncAvailable}
			<section>
				<h3>{m.sync_title()}</h3>
				<div class="tile">
					<div class="row">
						<span class="lead"><Wifi size={17} /></span>
						<span class="text">
							<strong>{m.sync_enable()}</strong>
							<small>{sync?.running ? m.sync_running() : m.sync_paused()}</small>
						</span>
						<Toggle
							label={m.sync_enable()}
							checked={Boolean(sync?.enabled)}
							disabled={syncBusy}
							onchange={onsynctoggle}
						/>
					</div>
					{#if sync?.running}
						<div class="row">
							<span class="lead"><Wifi size={17} /></span>
							<span class="text">
								<strong>{m.sync_discovery()}</strong>
								<small>{sync.discovery ? discoveryLabel(sync.discovery) : m.sync_discovery_off()}</small>
							</span>
							<button
								type="button"
								class="btn compact"
								disabled={syncBusy}
								onclick={onsyncdiscoveryrestart}
							>
								{m.sync_discovery_restart()}
							</button>
						</div>
						{#if sync.discovery?.state === 'permission'}
							<div class="actions">
								<button type="button" class="btn" onclick={openAppSettings}>
									{m.sync_discovery_settings()}
								</button>
							</div>
						{/if}
						{#each sync.peers as peer (peer.endpointId)}
							<div class="row">
								<span class="lead"><Smartphone size={17} /></span>
								<span class="text">
									<strong>{peer.name}</strong>
									<small>{lastSyncLabel(peer.lastSyncAt)}</small>
								</span>
								<button
									type="button"
									class="btn compact"
									disabled={syncBusy}
									onclick={() => onunpair(peer)}
								>
									{m.sync_unpair()}
								</button>
							</div>
						{/each}
						<div class="actions">
							<button type="button" class="btn" disabled={syncBusy} onclick={onsyncnow}>
								<RefreshCw size={16} />
								{m.sync_now()}
							</button>
							<button type="button" class="btn" disabled={syncBusy} onclick={onpair}>
								<Link2 size={16} />
								{m.sync_pair()}
							</button>
						</div>
						{#if sync.peers.length === 0}
							<p class="footnote">{m.sync_no_peers()}</p>
						{/if}
					{/if}
				</div>
			</section>
		{/if}

		<section>
			<details class="advanced">
				<summary>{m.settings_section_advanced()}</summary>
				<div class="tile">
					<div class="row">
						<span class="lead"><FlaskConical size={17} /></span>
						<span class="text">
							<strong>{m.settings_test_mode_title()}</strong>
							<small>{m.settings_test_mode_hint()}</small>
						</span>
						<Toggle label={m.settings_test_mode_title()} checked={testMode} onchange={ontestmode} />
					</div>
					{#if syncAvailable}
						<div class="row">
							<span class="lead"><Timer size={17} /></span>
							<span class="text">
								<strong>{m.sync_auto_title()}</strong>
								<small>{sync?.enabled ? m.sync_auto_hint() : m.sync_auto_requires()}</small>
							</span>
							<Toggle
								label={m.sync_auto_title()}
								checked={Boolean(sync?.autoSync)}
								disabled={syncBusy || !sync?.enabled}
								onchange={onsyncauto}
							/>
						</div>
						{#if sync?.autoSync && sync?.enabled}
							<div class="row">
								<span class="lead"><RefreshCw size={17} /></span>
								<span class="text">
									<strong>{m.sync_auto_interval()}</strong>
									<small>{m.sync_auto_interval_hint()}</small>
								</span>
								<input
									class="select interval"
									type="number"
									min="1"
									max="300"
									step="1"
									inputmode="numeric"
									aria-label={m.sync_auto_interval()}
									value={sync?.intervalSecs ?? 2}
									disabled={syncBusy}
									onchange={handleInterval}
								/>
							</div>
						{/if}
					{/if}
					{#if testMode && notificationsDiagnostics}
						<div class="row diag">
							<span class="text">
								<strong>Diagnóstico de notificações</strong>
								<small>
									Permissão: {notificationsDiagnostics.permission === null ? '—' : notificationsDiagnostics.permission ? 'concedida' : 'negada'} ·
									{notificationsDiagnostics.scheduled} agendadas · próxima: {diagnosticsWhen(notificationsDiagnostics.next)}
								</small>
								{#if notificationsDiagnostics.error}<small class="err">{notificationsDiagnostics.error}</small>{/if}
							</span>
							<span class="actions">
								<button type="button" class="btn compact" onclick={onnotificationsdiagnostics}>Atualizar</button>
								<button type="button" class="btn compact" onclick={onnotificationstest}>Testar agora</button>
							</span>
						</div>
					{/if}
				</div>
			</details>
		</section>

		<section>
			<h3>{m.settings_backup_title()}</h3>
			<div class="tile">
				<div class="actions">
					<button type="button" class="btn" onclick={onexport}>
						<ArrowDownRight size={16} />
						{m.settings_backup_export()}
					</button>
					<button type="button" class="btn" onclick={onimport}>
						<ArrowUpRight size={16} />
						{m.settings_backup_import()}
					</button>
				</div>
				<p class="footnote">{m.settings_backup_footnote()}</p>
			</div>
		</section>

		{#if updaterAvailable}
			<section>
				<h3>{m.settings_updates_title()}</h3>
				<div class="tile">
					<div class="row">
						<span class="lead"><RefreshCw size={17} /></span>
						<span class="text">
							<strong>{m.settings_updates_strong()}</strong>
							<small>{updaterStatus || m.settings_updates_hint()}</small>
						</span>
						<button
							type="button"
							class="btn compact"
							disabled={updaterBusy}
							onclick={oncheckupdates}
						>
							{updaterBusy ? m.settings_updates_busy() : m.settings_updates_action()}
						</button>
					</div>
				</div>
			</section>
		{/if}

		<button type="button" class="pause" onclick={onpause}>
			<Flame size={16} />
			{m.settings_pause()}
		</button>

		<p class="version" aria-label="Versão do app">
			Atlas {__ATLAS_VERSION__} · {__ATLAS_COMMIT__}
		</p>
	</div>
</Sheet>

<style>
	.content {
		display: grid;
		gap: 18px;
		padding-bottom: 6px;
	}
	section {
		display: grid;
		gap: 8px;
	}
	h3 {
		margin: 0;
		color: var(--mu);
		font-size: 12px;
		font-weight: 600;
	}
	.advanced summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: 0;
		padding: 0 2px;
		color: var(--mu);
		font-size: 12px;
		font-weight: 600;
		list-style: none;
		cursor: pointer;
	}
	.advanced summary::-webkit-details-marker {
		display: none;
	}
	.advanced summary::after {
		content: '+';
		color: var(--mu);
		font-size: 16px;
		font-weight: 400;
	}
	.advanced[open] summary::after {
		content: '−';
	}
	.advanced .tile {
		margin-top: 8px;
	}
	.tile {
		padding: 4px 14px;
		border-radius: 10px;
		background: var(--panel);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		padding: 8px 0;
		border-top: 1px solid var(--ln);
	}
	.row:first-child,
	.tile > .actions:first-child {
		border-top: 0;
	}
	.lead {
		flex: none;
		display: grid;
		place-items: center;
		color: var(--mu);
	}
	.text {
		flex: 1;
		display: grid;
		gap: 2px;
		min-width: 0;
	}
	.text strong {
		color: var(--tx);
		font-size: 14px;
		font-weight: 600;
	}
	.text small {
		color: var(--mu);
		font-size: 12px;
	}
	.select {
		flex: none;
		min-height: 34px;
		padding: 0 10px;
		border: 1px solid var(--ln);
		border-radius: 8px;
		background: var(--s2);
		color: var(--tx);
		font-size: 13px;
		color-scheme: dark;
	}
	.interval {
		width: 76px;
		text-align: right;
	}
	.actions {
		display: flex;
		gap: 8px;
		padding: 10px 0 4px;
	}
	.row.diag {
		align-items: flex-start;
	}
	.row.diag .actions {
		flex-wrap: wrap;
		justify-content: flex-end;
		padding: 0;
	}
	.text small.err {
		color: #ff8f8f;
	}
	/* Em telas estreitas o rótulo + selo "Em breve" não cabem lado a lado. */
	@media (max-width: 480px) {
		.actions {
			flex-direction: column;
		}
	}
	.btn {
		flex: 1;
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 0 12px;
		border: 0;
		border-radius: 10px;
		background: var(--s2);
		color: var(--mu);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	/* Botão de ação dentro de uma linha do tile (não divide espaço com outro). */
	.btn.compact {
		flex: none;
		min-height: 34px;
		color: var(--tx);
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.footnote {
		margin: 0;
		padding: 2px 0 10px;
		color: var(--mu);
		font-size: 12px;
		line-height: 1.45;
	}
	.pause {
		min-height: 48px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border: 1px solid var(--ln);
		border-radius: 12px;
		background: transparent;
		color: var(--flame);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}
	.version {
		margin: 2px 0 0;
		color: var(--mu);
		font-size: 11px;
		text-align: center;
		letter-spacing: 0.02em;
	}
</style>
