<script lang="ts">
	import { Bell, CircleDollarSign, FlaskConical, Keyboard, Volume2, Vibrate, ArrowDownRight, ArrowUpRight, Plus, Flame } from '@lucide/svelte';
	import type { AtlasSnapshot, Category } from '#lib/atlas';
	import { m } from '#lib/paraglide/messages.js';
	import Segmented from '#lib/components/ui/Segmented.svelte';
	import Sheet from '#lib/components/ui/Sheet.svelte';
	import Toggle from '#lib/components/ui/Toggle.svelte';

	/**
	 * Configurações seguindo `docs/DESIGN.md` §4: sheet com tiles, sem
	 * eyebrow, poucas palavras. Toda a lógica continua no `+page.svelte`;
	 * aqui só mora a apresentação.
	 */
	let {
		snapshot,
		testMode,
		onclose,
		onnotifications,
		onpreference,
		oncurrency,
		ontestmode,
		onaddcategory,
		onrenamecategory,
		onpause,
		onbackup
	}: {
		snapshot: AtlasSnapshot;
		testMode: boolean;
		onclose: () => void;
		onnotifications: (enabled: boolean) => void;
		onpreference: (
			key: 'soundEnabled' | 'typingSoundEnabled' | 'hapticsEnabled',
			enabled: boolean
		) => void;
		oncurrency: (value: string) => Promise<boolean>;
		ontestmode: (enabled: boolean) => void;
		onaddcategory: (input: { module: 'finance' | 'time'; name: string; color: string }) => void;
		onrenamecategory: (category: Category) => void;
		onpause: () => void;
		onbackup: () => void;
	} = $props();

	/** Paleta de categorias do guia (`docs/DESIGN.md` §2). */
	const PALETTE = ['#d4f25a', '#9cc8ff', '#ffb347', '#c6a8ff', '#f1a5c5', '#7fe3c4'];

	let categoryName = $state('');
	let categoryModule = $state<'finance' | 'time'>('finance');
	let categoryColor = $state(PALETTE[0]);

	const modules = $derived([
		{ value: 'finance', label: m.settings_module_finance() },
		{ value: 'time', label: m.settings_module_time() }
	]);

	async function handleCurrency(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		if (!(await oncurrency(select.value))) select.value = snapshot.preferences.currency;
	}

	function submitCategory(event: SubmitEvent) {
		event.preventDefault();
		const name = categoryName.trim();
		if (!name) return;
		onaddcategory({ module: categoryModule, name, color: categoryColor });
		categoryName = '';
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
					<span class="lead"><FlaskConical size={17} /></span>
					<span class="text">
						<strong>{m.settings_test_mode_title()}</strong>
						<small>{m.settings_test_mode_hint()}</small>
					</span>
					<Toggle label={m.settings_test_mode_title()} checked={testMode} onchange={ontestmode} />
				</div>
			</div>
		</section>

		<section>
			<h3>{m.settings_backup_title()}</h3>
			<div class="tile">
				<div class="actions">
					<button type="button" class="btn" aria-disabled="true" onclick={onbackup}>
						<ArrowDownRight size={16} />
						{m.settings_backup_export()}
						<em>{m.settings_backup_soon()}</em>
					</button>
					<button type="button" class="btn" aria-disabled="true" onclick={onbackup}>
						<ArrowUpRight size={16} />
						{m.settings_backup_import()}
						<em>{m.settings_backup_soon()}</em>
					</button>
				</div>
				<p class="footnote">{m.settings_backup_footnote()}</p>
			</div>
		</section>

		<section>
			<h3>{m.settings_categories_title()}</h3>
			<div class="tile">
				<form class="new-category" onsubmit={submitCategory}>
					<Segmented
						label={m.settings_categories_title()}
						options={modules}
						bind:value={categoryModule}
					/>
					<div class="new-category-line">
						<input
							class="input"
							aria-label={m.settings_categories_new()}
							placeholder={m.settings_categories_new()}
							bind:value={categoryName}
						/>
						<button type="submit" class="add" aria-label={m.settings_categories_add()}>
							<Plus size={16} />
						</button>
					</div>
					<div class="swatches" role="group" aria-label={m.settings_categories_color()}>
						{#each PALETTE as color (color)}
							<button
								type="button"
								class="swatch"
								style={`--c:${color}`}
								aria-pressed={color === categoryColor}
								aria-label={color}
								onclick={() => (categoryColor = color)}
							></button>
						{/each}
					</div>
				</form>
				<div class="categories">
					{#each snapshot.categories as category (category.id)}
						<button type="button" class="category" onclick={() => onrenamecategory(category)}>
							<i style={`background:${category.color}`}></i>
							{category.name}
							<span>{category.module === 'finance' ? m.settings_module_finance() : m.settings_module_time()}</span>
						</button>
					{/each}
				</div>
			</div>
		</section>

		<button type="button" class="pause" onclick={onpause}>
			<Flame size={16} />
			{m.settings_pause()}
		</button>
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
	.tile > .actions:first-child,
	.tile > .new-category:first-child {
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
	.actions {
		display: flex;
		gap: 8px;
		padding: 10px 0 4px;
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
	.btn em {
		padding: 2px 6px;
		border-radius: 6px;
		background: var(--accd);
		color: var(--acc);
		font-size: 10px;
		font-style: normal;
		font-weight: 700;
	}
	.footnote {
		margin: 0;
		padding: 2px 0 10px;
		color: var(--mu);
		font-size: 12px;
		line-height: 1.45;
	}
	.new-category {
		display: grid;
		gap: 10px;
		padding: 10px 0;
	}
	.new-category-line {
		display: flex;
		gap: 8px;
	}
	.input {
		flex: 1;
		min-height: 40px;
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
	.add {
		flex: none;
		width: 40px;
		height: 40px;
		display: grid;
		place-items: center;
		padding: 0;
		border: 0;
		border-radius: 10px;
		background: var(--acc);
		color: var(--on-acc);
		cursor: pointer;
	}
	.swatches {
		display: flex;
		gap: 8px;
	}
	.swatch {
		width: 28px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: var(--c);
		cursor: pointer;
		opacity: 0.5;
		transition: opacity 0.15s var(--ease-smooth), transform 0.15s var(--ease-spring);
	}
	.swatch[aria-pressed='true'] {
		opacity: 1;
		transform: scale(1.12);
	}
	.categories {
		display: grid;
	}
	.category {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 46px;
		padding: 0;
		border: 0;
		border-top: 1px solid var(--ln);
		background: transparent;
		color: var(--tx);
		font-size: 14px;
		text-align: left;
		cursor: pointer;
	}
	.category i {
		width: 10px;
		height: 10px;
		flex: none;
		border-radius: 50%;
	}
	.category span {
		margin-left: auto;
		color: var(--mu);
		font-size: 12px;
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
	@media (prefers-reduced-motion: reduce) {
		.swatch {
			transition: none;
		}
	}
</style>
