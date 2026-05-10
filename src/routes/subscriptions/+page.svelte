<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
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

		<button class="btn btn-primary" type="submit">Add subscription</button>

		{#if form?.error}
			<p class="text-error">{form.error}</p>
		{/if}
	</form>

	<section class="rounded-lg bg-base-100 p-4 shadow">
		{#if data.subscriptions.length}
			<div class="overflow-x-auto">
				<table class="table">
					<thead>
						<tr>
							<th>URL</th>
							<th>Interval</th>
							<th>Last check</th>
							<th>Status</th>
							<th class="text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each data.subscriptions as subscription}
							<tr>
								<td class="max-w-sm truncate">{subscription.url}</td>
								<td>{subscription.intervalMinutes} min</td>
								<td>
									{subscription.lastCheckedAt
										? new Date(subscription.lastCheckedAt).toLocaleString()
										: 'Never'}
								</td>
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
