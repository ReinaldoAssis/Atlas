<script lang="ts">
	/**
	 * Kit Atlas — interruptor 48×28 (`docs/DESIGN.md` §4).
	 *
	 * Visual próprio (botão com `role="switch"`), então funciona igual em
	 * WebKit/WebView2 e é acessível por teclado sem código extra.
	 */
	let {
		checked = $bindable(false),
		label,
		disabled = false,
		onchange
	}: {
		checked?: boolean;
		label: string;
		disabled?: boolean;
		onchange?: (checked: boolean) => void;
	} = $props();

	function toggle() {
		if (disabled) return;
		checked = !checked;
		onchange?.(checked);
	}
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	class="toggle"
	class:on={checked}
	{disabled}
	onclick={toggle}
>
	<span class="knob" aria-hidden="true"></span>
</button>

<style>
	.toggle {
		position: relative;
		flex: none;
		width: 48px;
		height: 28px;
		padding: 0;
		border: 0;
		border-radius: 14px;
		background: var(--s2);
		cursor: pointer;
		transition: background 0.2s var(--ease-smooth);
	}
	.toggle.on {
		background: var(--acc);
	}
	.knob {
		position: absolute;
		top: 3px;
		left: 3px;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--tx);
		transition: transform 0.28s var(--ease-spring), background 0.2s var(--ease-smooth);
	}
	.toggle.on .knob {
		transform: translateX(20px);
		background: var(--on-acc);
	}
	@media (prefers-reduced-motion: reduce) {
		.toggle,
		.knob {
			transition: none;
		}
	}
</style>
