<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{data.title ?? 'Video'} — Video Fetcher</title>
</svelte:head>

<div class="mx-auto w-full max-w-4xl space-y-4 px-4">
	<a href={resolve('/')} class="btn btn-ghost btn-sm">← Back to downloads</a>

	<section class="space-y-3 rounded-lg bg-base-100 p-4 shadow">
		<h1 class="truncate text-lg font-semibold">{data.title}</h1>

		{#if data.available}
			<video
				class="max-h-[70vh] w-full rounded bg-black"
				controls
				autoplay
				preload="metadata"
				src={resolve('/api/media/[id]', { id: data.id })}
			>
				<track kind="captions" />
			</video>
		{:else}
			<div class="alert alert-warning">
				<span>
					{#if !data.hasFile}
						This download has no associated file to play.
					{:else}
						The file is no longer available. It may have been moved or deleted.
					{/if}
				</span>
			</div>
		{/if}
	</section>
</div>
