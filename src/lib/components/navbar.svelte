<script lang="ts">
	import { onMount } from 'svelte';

	type Theme = 'system' | 'dark' | 'light';
	const STORAGE_KEY = 'theme';

	let theme: Theme = 'system';

	function applyTheme(value: Theme) {
		theme = value;

		if (value === 'system') {
			document.documentElement.removeAttribute('data-theme');
			localStorage.removeItem(STORAGE_KEY);
		} else {
			document.documentElement.setAttribute('data-theme', value);
			localStorage.setItem(STORAGE_KEY, value);
		}
	}

	onMount(() => {
		const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;

		if (stored === 'dark' || stored === 'light') {
			applyTheme(stored);
		} else {
			applyTheme('system');
		}
	});
</script>

<div class="navbar bg-base-200 shadow-sm">
	<div class="flex-1 gap-2">
		<a href="/" class="btn text-xl font-bold hover:btn-accent">Video Fetch</a>
		<a href="/add" class="btn hover:btn-accent">Add</a>
		<a href="/subscriptions" class="btn hover:btn-accent">Subscriptions</a>
	</div>

	<div class="flex-none">
		<select
			class="select select-sm"
			bind:value={theme}
			onchange={(e) => applyTheme(e.currentTarget.value as Theme)}
			title="Theme"
		>
			<option value="system">System</option>
			<option value="dark">Dark</option>
			<option value="light">Light</option>
		</select>
	</div>
</div>
