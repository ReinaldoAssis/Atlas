<script lang="ts">
	import Sheet from '#lib/components/ui/Sheet.svelte';
	import { m } from '#lib/paraglide/messages.js';

	/**
	 * Confirmação do SAS de 6 dígitos (`docs/SYNC.md` §3).
	 *
	 * Os dois aparelhos mostram o mesmo código; o humano compara e confirma nos
	 * dois. O app nunca confirma sozinho.
	 */
	let {
		peerName,
		sas,
		busy = false,
		onconfirm,
		oncancel
	}: {
		peerName: string;
		sas: string;
		busy?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	} = $props();
</script>

<Sheet title={m.sync_sas_title()} closeLabel={m.settings_close()} onclose={oncancel}>
	<div class="sas">
		<p class="peer">{peerName}</p>
		<div class="code" aria-label={sas}>{sas}</div>
		<p class="hint">{m.sync_sas_hint()}</p>
		<div class="actions">
			<button type="button" class="ghost" disabled={busy} onclick={oncancel}>
				{m.sync_cancel()}
			</button>
			<button type="button" class="primary" disabled={busy} onclick={onconfirm}>
				{m.sync_confirm()}
			</button>
		</div>
	</div>
</Sheet>

<style>
	.sas {
		display: grid;
		gap: 14px;
		padding: 6px 0 14px;
		text-align: center;
	}
	.peer {
		margin: 0;
		color: var(--mu);
		font-size: 14px;
	}
	.code {
		font-size: 44px;
		font-weight: 700;
		letter-spacing: 0.22em;
		color: var(--tx);
		font-variant-numeric: tabular-nums;
	}
	.hint {
		margin: 0;
		color: var(--mu);
		font-size: 13px;
		line-height: 1.45;
	}
	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		padding-top: 4px;
	}
	button {
		min-height: 46px;
		border: 0;
		border-radius: 12px;
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.ghost {
		background: var(--s2);
		color: var(--mu);
	}
	.primary {
		background: var(--acc);
		color: var(--on-acc);
	}
</style>
