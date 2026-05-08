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

	function removeFromFinished(id: string) {
		finishedDownloads.update((list) => list.filter((d) => d.id !== id));
	}

	function removeFromAll(id: string) {
		activeDownloads.update((list) => list.filter((d) => d.id !== id));
		finishedDownloads.update((list) => list.filter((d) => d.id !== id));
	}

	onMount(() => {
		const evtSource = new EventSource('/api/downloads');

		finishedDownloads.set(data.download.filter((d) => ['finished', 'error'].includes(d.status)));

		activeDownloads.set(
			data.download.filter((d) => ['downloading', 'pending', 'queued', 'paused'].includes(d.status))
		);

		evtSource.onmessage = (event) => {
			try {
				const updates: DownloadUpdate[] = JSON.parse(event.data);

				const finished = updates.filter((d) => ['finished', 'error'].includes(d.status));

				finishedDownloads.update((current) => {
					const map = new SvelteMap(current.map((d) => [d.id, d]));
					for (const d of finished) map.set(d.id, d);
					return Array.from(map.values());
				});

				const finishedIds = finished.map((d) => d.id);

				activeDownloads.set(
					updates.filter(
						(d) =>
							['downloading', 'pending', 'queued', 'paused'].includes(d.status) &&
							!finishedIds.includes(d.id)
					)
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
			case 'pending':
				return 'Preparing';
			case 'finished':
				return 'Finished';
			case 'error':
				return 'Error';
			default:
				return status;
		}
	}

	function formatInfo(d: DownloadUpdate) {
		if (!d.progress) return 'No info';

		const parts: string[] = [d.progress.percentage_str, d.progress.total_str, d.progress.speed_str];

		if (d.progress.eta) parts.push(`ETA ${d.progress.eta_str}`);
		parts.push(d.progress.downloaded_str);

		return parts.join(' · ');
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

<div class="mx-auto w-full max-w-4xl space-y-4 px-4">
	<!-- Settings -->
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

	<!-- Active Downloads -->
	<section class="rounded-lg bg-base-100 p-4 shadow">
		<h2 class="mb-3 text-lg font-semibold">Active Downloads</h2>

		{#if $activeDownloads.length}
			<div class="space-y-3">
				{#each $activeDownloads as d (d.id)}
					<div class="rounded-lg border bg-base-200 p-3">
						<div class="flex justify-between gap-3">
							<div class="min-w-0">
								<p class="truncate font-medium">{d.fileName ?? 'Unnamed'}</p>
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

								<form
									action="?/cancelDownload"
									method="post"
									class="btn text-error btn-ghost btn-xs"
									use:enhance
								>
									<input type="hidden" name="id" value={d.id} />
									<button><Cancel class="size-4" /></button>
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

	<!-- Finished Downloads -->
	<section class="rounded-lg bg-base-100 p-4 shadow">
		<h2 class="mb-3 text-lg font-semibold">Finished</h2>

		{#if $finishedDownloads.length}
			<div class="overflow-x-auto">
				<table class="table table-sm">
					<thead>
						<tr>
							<th>Name</th>
							<th>Status</th>
							<th>Info</th>
							<th class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each $finishedDownloads as d (d.id)}
							<tr class={d.status === 'error' ? 'bg-error/10' : ''}>
								<td class="max-w-xs truncate">{d.fileName ?? 'Unnamed'}</td>
								<td class={d.status === 'error' ? 'text-error' : 'text-success'}>
									{statusLabel(d.status)}
								</td>
								<td class="text-xs text-gray-500">
									{d.status === 'error' ? (d.errorMessage ?? 'Unknown error') : '—'}
								</td>
								<td class="flex justify-end gap-1">
									{#if d.status === 'error'}
										<form
											action="?/retryDownload"
											method="post"
											use:enhance={() => removeFromFinished(d.id)}
											class="btn btn-ghost btn-xs"
										>
											<input type="hidden" name="id" value={d.id} />
											<button><Retry class="size-4" /></button>
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
										class="btn text-error btn-ghost btn-xs"
									>
										<input type="hidden" name="id" value={d.id} />
										<button><Trash class="size-4" /></button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="text-sm text-gray-500">No finished downloads yet.</p>
		{/if}
	</section>
</div>
