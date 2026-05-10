<script lang="ts">
	import { enhance } from '$app/forms';
	import { maxConcurrency } from '$lib';
	import Cancel from '$lib/assets/cancel.svelte';
	import Copy from '$lib/assets/copy.svelte';
	import Retry from '$lib/assets/retry.svelte';
	import Trash from '$lib/assets/trash.svelte';
	import type { DownloadUpdate } from '$lib/types/download';
	import { SvelteMap } from 'svelte/reactivity';
	import type { PageProps } from './$types';
	import { onMount } from 'svelte';
	import { writable } from 'svelte/store';

	let { data }: PageProps = $props();

	const activeDownloads = writable<DownloadUpdate[]>([]);
	const finishedDownloads = writable<DownloadUpdate[]>([]);
	let search = $state('');

	const activeStatuses = ['downloading', 'pending', 'metadata_fetching', 'queued'];
	const finishedStatuses = ['completed', 'failed', 'cancelled'];

	function removeFromFinished(id: string) {
		finishedDownloads.update((list) => list.filter((d) => d.id !== id));
	}

	function removeFromAll(id: string) {
		activeDownloads.update((list) => list.filter((d) => d.id !== id));
		finishedDownloads.update((list) => list.filter((d) => d.id !== id));
	}

	onMount(() => {
		const evtSource = new EventSource('/api/downloads');

		finishedDownloads.set(data.download.filter((d) => finishedStatuses.includes(d.status)));
		activeDownloads.set(data.download.filter((d) => activeStatuses.includes(d.status)));

		evtSource.onmessage = (event) => {
			try {
				const updates: DownloadUpdate[] = JSON.parse(event.data);
				const finished = updates.filter((d) => finishedStatuses.includes(d.status));

				finishedDownloads.update((current) => {
					const map = new SvelteMap(current.map((d) => [d.id, d]));
					for (const d of finished) map.set(d.id, d);
					return Array.from(map.values());
				});

				const finishedIds = finished.map((d) => d.id);
				activeDownloads.set(
					updates.filter((d) => activeStatuses.includes(d.status) && !finishedIds.includes(d.id))
				);
			} catch (err) {
				console.error('Invalid SSE data', err);
			}
		};

		return () => evtSource.close();
	});

	function statusLabel(status: string) {
		switch (status) {
			case 'downloading':
				return 'Downloading';
			case 'queued':
				return 'Queued';
			case 'metadata_fetching':
				return 'Fetching metadata';
			case 'pending':
				return 'Pending';
			case 'completed':
				return 'Completed';
			case 'failed':
				return 'Failed';
			case 'cancelled':
				return 'Cancelled';
			default:
				return status;
		}
	}

	function formatInfo(d: DownloadUpdate) {
		if (!d.progress) return d.folder ? `Folder: ${d.folder}` : 'No info';

		const parts: string[] = [d.progress.percentage_str, d.progress.total_str, d.progress.speed_str];
		if (d.progress.eta) parts.push(`ETA ${d.progress.eta_str}`);
		parts.push(d.progress.downloaded_str);
		return parts.join(' · ');
	}

	function visibleFinished(items: DownloadUpdate[]) {
		const term = search.trim().toLowerCase();
		if (!term) return items;

		return items.filter((d) =>
			[d.fileName, d.title, d.videoUrl, d.folder, d.errorMessage]
				.filter(Boolean)
				.some((value) => String(value).toLowerCase().includes(term))
		);
	}

	function canPlay(d: DownloadUpdate) {
		return !!d.filePath && /\.(mp4|webm|mp3|m4a|opus)$/i.test(d.filePath);
	}

	async function copyUrl(url?: string) {
		if (!url) return;
		try {
			await navigator.clipboard.writeText(url);
			alert('URL copied to clipboard!');
		} catch (err) {
			console.error('Copy failed', err);
		}
	}
</script>

<div class="mx-auto w-full max-w-5xl space-y-4 px-4">
	<section class="space-y-3 rounded-lg bg-base-100 p-4 shadow">
		<form method="POST" action="?/setConcurrency" use:enhance>
			<span class="font-medium">Parallel Downloads</span>
			<input
				type="range"
				name="concurrency"
				min="1"
				max={maxConcurrency}
				value={data.parallelDownloads}
				class="range range-primary"
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
			/>
			<p class="text-sm text-gray-500">Current: {data.parallelDownloads}</p>
		</form>

		<form method="POST" action="?/setPause" use:enhance>
			<input type="hidden" name="pause" value={data.isPaused ? 'false' : 'true'} />
			<button class="btn w-full btn-outline">
				{data.isPaused ? 'Start' : 'Pause'}
			</button>
		</form>
	</section>

	<section class="rounded-lg bg-base-100 p-4 shadow">
		<h2 class="mb-3 text-lg font-semibold">Active Downloads</h2>

		{#if $activeDownloads.length}
			<div class="space-y-3">
				{#each $activeDownloads as d (d.id)}
					<div class="rounded-lg border bg-base-200 p-3">
						<div class="flex justify-between gap-3">
							<div class="min-w-0">
								<p class="truncate font-medium">{d.fileName ?? d.title ?? 'Unnamed'}</p>
								<p class="text-xs text-gray-500">{statusLabel(d.status)}</p>
							</div>

							<div class="flex gap-1">
								<button
									class="btn btn-ghost btn-xs"
									title="Copy link"
									onclick={() => copyUrl(d.videoUrl)}
								>
									<Copy class="size-4" />
								</button>

								<form action="?/cancelDownload" method="post" use:enhance>
									<input type="hidden" name="id" value={d.id} />
									<button class="btn text-error btn-ghost btn-xs">
										<Cancel class="size-4" />
									</button>
								</form>
							</div>
						</div>

						{#if d.progress?.percentage}
							<div class="mt-2 h-2 w-full rounded bg-gray-300">
								<div
									class="h-2 rounded bg-primary transition-all"
									style="width: {d.progress.percentage.toFixed(1)}%;"
								></div>
							</div>
						{/if}

						<p class="mt-1 text-xs text-gray-500">{formatInfo(d)}</p>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-sm text-gray-500">No active downloads.</p>
		{/if}
	</section>

	<section class="rounded-lg bg-base-100 p-4 shadow">
		<div class="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<h2 class="text-lg font-semibold">Archive</h2>
			<input
				type="search"
				class="input-bordered input input-sm w-full sm:max-w-xs"
				placeholder="Search history"
				bind:value={search}
			/>
		</div>

		{#if visibleFinished($finishedDownloads).length}
			<div class="grid gap-3">
				{#each visibleFinished($finishedDownloads) as d (d.id)}
					<div
						class={`rounded-lg border p-3 ${d.status === 'failed' ? 'bg-error/10' : 'bg-base-200'}`}
					>
						<div class="grid gap-3 md:grid-cols-[120px_1fr_auto]">
							<div class="aspect-video overflow-hidden rounded bg-base-300">
								{#if d.thumbnailUrl}
									<img src={d.thumbnailUrl} alt="" class="h-full w-full object-cover" />
								{/if}
							</div>

							<div class="min-w-0 space-y-1">
								<p class="truncate font-medium">{d.fileName ?? d.title ?? 'Unnamed'}</p>
								<p class="text-xs text-gray-500">{d.title ?? d.videoUrl}</p>
								<p class={d.status === 'failed' ? 'text-sm text-error' : 'text-sm text-success'}>
									{statusLabel(d.status)}
									{#if d.errorMessage}
										<span class="text-gray-500">- {d.errorMessage}</span>
									{/if}
								</p>
								{#if canPlay(d)}
									<video
										class="mt-2 max-h-72 w-full rounded bg-black"
										controls
										preload="metadata"
										src={`/api/media/${d.id}`}
									>
										<track kind="captions" />
									</video>
								{/if}
							</div>

							<div class="flex justify-end gap-1">
								{#if d.status === 'failed'}
									<form
										action="?/retryDownload"
										method="post"
										use:enhance={() => removeFromFinished(d.id)}
									>
										<input type="hidden" name="id" value={d.id} />
										<button class="btn btn-ghost btn-xs"><Retry class="size-4" /></button>
									</form>
								{/if}

								<button
									class="btn btn-ghost btn-xs"
									title="Copy link"
									onclick={() => copyUrl(d.videoUrl)}
								>
									<Copy class="size-4" />
								</button>

								<form
									action="?/deleteDownload"
									method="post"
									use:enhance={() => removeFromAll(d.id)}
								>
									<input type="hidden" name="id" value={d.id} />
									<button class="btn text-error btn-ghost btn-xs">
										<Trash class="size-4" />
									</button>
								</form>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-sm text-gray-500">No completed downloads yet.</p>
		{/if}
	</section>
</div>
