<script lang="ts">
	import { Link2, Smartphone } from '@lucide/svelte';
	import Sheet from '#lib/components/ui/Sheet.svelte';
	import { m } from '#lib/paraglide/messages.js';
	import { shortId, type SyncDiscovered } from '#lib/sync';

	/** Lista de aparelhos descobertos + entrada manual (`ip:porta`). */
	let {
		devices,
		busy = false,
		onconnect,
		onrefresh,
		onclose
	}: {
		devices: SyncDiscovered[];
		busy?: boolean;
		onconnect: (peer: string, address?: string) => void;
		onrefresh: () => void;
		onclose: () => void;
	} = $props();

	let advanced = $state(false);
	let manualId = $state('');
	let manualAddress = $state('');

	function connectManual() {
		const id = manualId.trim();
		if (!id) return;
		const address = manualAddress.trim();
		onconnect(id, address || undefined);
	}
</script>

<Sheet title={m.sync_pair_title()} closeLabel={m.settings_close()} {onclose}>
	<div class="content">
		<div class="list">
			{#each devices as device (device.endpointId)}
				<div class="row">
					<span class="lead"><Smartphone size={17} /></span>
					<span class="text">
						<strong>{device.name}</strong>
						<small>{shortId(device.endpointId)}{device.address ? ` · ${device.address}` : ''}</small>
					</span>
					{#if device.paired}
						<span class="tag">{m.sync_paired()}</span>
					{:else}
						<button
							type="button"
							class="btn compact"
							disabled={busy}
							onclick={() => onconnect(device.endpointId)}
						>
							{m.sync_pair()}
						</button>
					{/if}
				</div>
			{:else}
				<p class="footnote">{m.sync_pair_searching()}</p>
			{/each}
		</div>

		<button type="button" class="link" onclick={onrefresh} disabled={busy}>
			<Link2 size={14} /> {m.sync_pair_refresh()}
		</button>

		<button type="button" class="link" onclick={() => (advanced = !advanced)}>
			<Link2 size={14} /> {m.sync_pair_manual()}
		</button>

		{#if advanced}
			<form class="manual" onsubmit={(event) => { event.preventDefault(); connectManual(); }}>
				<input
					class="input"
					aria-label={m.sync_pair_id()}
					placeholder={m.sync_pair_id()}
					bind:value={manualId}
					autocapitalize="off"
					autocomplete="off"
					spellcheck="false"
				/>
				<input
					class="input"
					aria-label={m.sync_pair_addr()}
					placeholder={m.sync_pair_addr()}
					bind:value={manualAddress}
					autocapitalize="off"
					autocomplete="off"
					spellcheck="false"
				/>
				<button type="submit" class="btn" disabled={busy}>{m.sync_pair_connect()}</button>
				<p class="footnote">{m.sync_pair_manual_hint()}</p>
			</form>
		{/if}
	</div>
</Sheet>

<style>
	.content {
		display: grid;
		gap: 12px;
		padding: 4px 0 12px;
	}
	.list {
		border-radius: 10px;
		background: var(--panel);
		padding: 0 14px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		padding: 8px 0;
		border-top: 1px solid var(--ln);
	}
	.row:first-child {
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
	.tag {
		flex: none;
		padding: 4px 8px;
		border-radius: 999px;
		background: var(--s2);
		color: var(--mu);
		font-size: 11px;
		font-weight: 600;
	}
	.btn {
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0 12px;
		border: 0;
		border-radius: 10px;
		background: var(--s2);
		color: var(--tx);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
	.btn.compact {
		flex: none;
		min-height: 34px;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 38px;
		border: 0;
		background: transparent;
		color: var(--mu);
		font-size: 13px;
		cursor: pointer;
	}
	.link:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.manual {
		display: grid;
		gap: 10px;
	}
	.input {
		min-height: 44px;
		padding: 0 12px;
		border: 1px solid var(--ln);
		border-radius: 10px;
		background: var(--s2);
		color: var(--tx);
		font-size: 14px;
		outline: none;
	}
	.input:focus {
		border-color: var(--acc);
	}
	.input::placeholder {
		color: var(--mu);
	}
	.footnote {
		margin: 0;
		color: var(--mu);
		font-size: 12px;
		line-height: 1.45;
	}
</style>
