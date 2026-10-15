<script lang="ts">
	let { color = 'var(--lime)', mini = false }: { color?: string; mini?: boolean } = $props();
</script>

<svg class="nt-fi" class:mi={mini} viewBox="0 0 40 32" style={`--cc:${color}`} aria-hidden="true">
	<path class="bk" d="M2 6a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v18a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" />
	<rect class="pp" x="7" y="9" width="26" height="14" rx="2" />
	<path class="fl" d="M2 15a3 3 0 0 1 3-3h30a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" />
</svg>
