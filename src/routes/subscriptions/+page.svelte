<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let importMode = $state('new_only');
	let showFilters = $state(false);
	let deletedIds = $state<string[]>([]);

	const subscriptions = $derived(data.subscriptions.filter((subscription) => !deletedIds.includes(subscription.id)));

	function confirmDelete(url: string) {
		return confirm(`Delete this subscription?\n\n${url}\n\nDownloaded files and history will stay untouched.`);
	}

	function removeSubscription(id: string) {
		if (!deletedIds.includes(id)) deletedIds = [...deletedIds, id];
	}
</script>

<div class="w-full max-w-5xl space-y-4 px-4">
	<form method="POST" action="?/add" class="grid gap-4 rounded-lg bg-base-100 p-6 shadow" use:enhance>
		<h1 class="text-xl font-semibold">Subscriptions</h1>

		<label class="flex flex-col">
			<span class="font-medium">Channel or playlist URL</span>
			<input name="url" type="url" required placeholder="https://" class="input-bordered input w-full" />
		</label>

		<div class="grid gap-4 md:grid-cols-2">
			<label class="flex flex-col">
				<span class="font-medium">Polling interval</span>
				<input
					name="interval_minutes"
					type="number"
					min="15"
					value="1440"
					class="input-bordered input w-full"
				/>
			</label>

			<label class="flex flex-col">
				<span class="font-medium">Start time</span>
				<input name="start_time" type="time" class="input-bordered input w-full" />
			</label>
		</div>

		<div class="grid gap-4 md:grid-cols-2">
			<label class="flex flex-col">
				<span class="font-medium">Download Profile</span>
				<select name="profile_id" class="select-bordered select w-full">
					{#each data.profiles as profile}
						<option value={profile.id} selected={profile.isDefault}>{profile.name}</option>
					{/each}
				</select>
			</label>

			<label class="flex flex-col">
				<span class="font-medium">Subfolder</span>
				<select name="folder" class="select-bordered select w-full">
					<option value="">No subfolder</option>
					{#each data.folders as folder}
						<option value={folder}>{folder}</option>
					{/each}
				</select>
			</label>
		</div>

		<div class="grid gap-4 rounded border border-base-300 p-4">
			<label class="flex flex-col">
				<span class="font-medium">Initial import</span>
				<select name="import_mode" class="select-bordered select w-full" bind:value={importMode}>
					<option value="new_only">Only new uploads</option>
					<option value="last_days">Import videos from last X days</option>
					<option value="last_videos">Import latest X videos</option>
					<option value="full_archive">Import everything</option>
				</select>
			</label>

			{#if importMode === 'last_days'}
				<label class="flex flex-col">
					<span class="font-medium">Days</span>
					<input name="import_limit" type="number" min="1" value="7" class="input-bordered input w-full" />
				</label>
			{:else if importMode === 'last_videos'}
				<label class="flex flex-col">
					<span class="font-medium">Videos</span>
					<input name="import_limit" type="number" min="1" value="20" class="input-bordered input w-full" />
				</label>
			{/if}
		</div>

		<label class="flex items-center gap-3">
			<input type="checkbox" class="toggle" bind:checked={showFilters} />
			<span>Filtering</span>
		</label>

		{#if showFilters}
			<div class="grid gap-4 rounded border border-base-300 p-4">
				<label class="flex items-center gap-3">
					<input name="exclude_shorts" type="checkbox" class="checkbox" />
					<span>Exclude Shorts</span>
				</label>

				<div class="grid gap-4 md:grid-cols-2">
					<label class="flex flex-col">
						<span class="font-medium">Minimum duration</span>
						<input
							name="min_duration"
							type="number"
							min="0"
							step="0.5"
							placeholder="Minutes"
							class="input-bordered input w-full"
						/>
					</label>

					<label class="flex flex-col">
						<span class="font-medium">Maximum duration</span>
						<input
							name="max_duration"
							type="number"
							min="0"
							step="0.5"
							placeholder="Minutes"
							class="input-bordered input w-full"
						/>
					</label>
				</div>

				<div class="grid gap-4 md:grid-cols-2">
					<label class="flex flex-col">
						<span class="font-medium">Include keywords</span>
						<input
							name="include_keywords"
							type="text"
							placeholder="review, tutorial"
							class="input-bordered input w-full"
						/>
					</label>

					<label class="flex flex-col">
						<span class="font-medium">Exclude keywords</span>
						<input
							name="exclude_keywords"
							type="text"
							placeholder="trailer, live"
							class="input-bordered input w-full"
						/>
					</label>
				</div>
			</div>
		{/if}

		<button class="btn btn-primary" type="submit">Add subscription</button>

		{#if form?.error}
			<p class="text-error">{form.error}</p>
		{/if}
	</form>

	<section class="rounded-lg bg-base-100 p-4 shadow">
		{#if subscriptions.length}
			<div class="overflow-x-auto">
				<table class="table">
					<thead>
						<tr>
							<th>URL</th>
							<th>Interval</th>
							<th>Last check</th>
							<th>Import</th>
							<th>Status</th>
							<th class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each subscriptions as subscription}
							<tr>
								<td class="max-w-sm truncate">{subscription.url}</td>
								<td>{subscription.intervalMinutes} min</td>
								<td>
									{subscription.lastCheckedAt
										? new Date(subscription.lastCheckedAt).toLocaleString()
										: 'Never'}
								</td>
								<td>{subscription.importMode.replaceAll('_', ' ')}</td>
								<td class={subscription.errorMessage ? 'text-error' : ''}>
									{subscription.enabled ? 'Enabled' : 'Disabled'}
									{#if subscription.errorMessage}
										<span class="block text-xs">{subscription.errorMessage}</span>
									{/if}
								</td>
								<td class="flex justify-end gap-2">
									<form method="POST" action="?/checkNow" use:enhance>
										<input type="hidden" name="id" value={subscription.id} />
										<button class="btn btn-sm btn-outline">Check now</button>
									</form>
									<form method="POST" action="?/toggle" use:enhance>
										<input type="hidden" name="id" value={subscription.id} />
										<input
											type="hidden"
											name="enabled"
											value={subscription.enabled ? 'false' : 'true'}
										/>
										<button class="btn btn-sm">{subscription.enabled ? 'Disable' : 'Enable'}</button>
									</form>
									<form
										method="POST"
										action="?/delete"
										onsubmit={(event) => {
											if (!confirmDelete(subscription.url)) event.preventDefault();
										}}
										use:enhance={() => {
											removeSubscription(subscription.id);
										}}
									>
										<input type="hidden" name="id" value={subscription.id} />
										<button class="btn btn-sm btn-error btn-outline">Delete</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="text-sm text-gray-500">No subscriptions yet.</p>
		{/if}
	</section>
</div>
