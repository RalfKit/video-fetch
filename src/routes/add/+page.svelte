<script lang="ts">
	import { enhance } from '$app/forms';
	import { writable } from 'svelte/store';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Tab state
	let active: 'single' | 'batch' = $state('single');

	// Batch textarea/file preview
	let importText = $state('');
	let importFile: File | null = $state(null);
	let fileInput: HTMLInputElement | null = $state(null);

	const preview = writable([] as { url: string; filename: string | null }[]);
	let batchError: string | null = $state(null);
	let refreshedFolders = $state<string[] | null>(null);
	let folders = $derived(refreshedFolders ?? data.folders ?? []);
	let showAdvanced = $state(false);

	const MAX_FILENAME_LENGTH = 200;

	/* -----------------------------
	 * Parsing
	 * ----------------------------- */
	function parseTSV(text: string) {
		const lines = text
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean);

		const rows: { url: string; filename: string | null }[] = [];

		for (const line of lines) {
			const [url = '', filename = ''] = line.split('\t');
			rows.push({
				url: url.trim(),
				filename: filename.trim() || null
			});
		}

		preview.set(rows);
	}

	/* -----------------------------
	 * Validation
	 * ----------------------------- */
	function validateTSV(text: string): boolean {
		batchError = null;

		const lines = text.split(/\r?\n/);

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const tabIndex = line.indexOf('\t');

			if (tabIndex === -1) continue;

			const name = line.slice(tabIndex + 1);

			if (name.length > MAX_FILENAME_LENGTH) {
				batchError = `Line ${i + 1}: Filename exceeds ${MAX_FILENAME_LENGTH} characters (${name.length})`;
				return false;
			}
		}

		return true;
	}

	/* -----------------------------
	 * Textarea handling
	 * ----------------------------- */
	function updateFromTextarea(value: string) {
		importText = value;

		// Clear file input when user edits manually
		if (fileInput) fileInput.value = '';
		importFile = null;

		if (validateTSV(importText)) {
			parseTSV(importText);
		} else {
			preview.set([]);
		}
	}

	function handleTextareaKeydown(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;

		e.preventDefault();

		const el = e.currentTarget as HTMLTextAreaElement;
		const start = el.selectionStart;
		const end = el.selectionEnd;

		const tab = '\t';

		const next = importText.slice(0, start) + tab + importText.slice(end);

		updateFromTextarea(next);

		queueMicrotask(() => {
			el.selectionStart = el.selectionEnd = start + tab.length;
		});
	}

	/* -----------------------------
	 * File handling
	 * ----------------------------- */
	function onFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const f = input.files?.[0];

		if (!f) {
			importFile = null;
			preview.set([]);
			return;
		}

		importFile = f;

		f.text().then((text) => {
			importText = text;
			validateTSV(text);
			parseTSV(text);
		});
	}

	async function refreshFolders() {
		const response = await fetch('/api/folders');
		const payload = await response.json();
		refreshedFolders = payload.folders ?? [];
	}
</script>

<div class="w-full max-w-4xl px-4">
	<div role="tablist" class="tabs-border mb-4 tabs">
		<button
			class={`tab ${active === 'single' ? 'tab-active' : ''}`}
			onclick={() => (active = 'single')}
		>
			Add Single
		</button>
		<button
			class={`tab ${active === 'batch' ? 'tab-active' : ''}`}
			onclick={() => (active = 'batch')}
		>
			Import Batch
		</button>
	</div>

	{#if active === 'single'}
		<form
			method="POST"
			action="?/addUrl"
			class="mb-6 rounded-lg bg-base-100 p-6 shadow-lg"
			use:enhance
		>
			<div class="grid gap-4">
				<label class="flex flex-col">
					<span class="font-medium">Video URL</span>
					<input
						name="video_url"
						type="url"
						required
						placeholder="https://"
						class="input-bordered input w-full"
					/>
				</label>

				<label class="flex flex-col">
					<span class="font-medium">Download Profile</span>
					<select name="profile_id" class="select-bordered select w-full">
						{#each data.profiles as profile}
							<option value={profile.id} selected={profile.isDefault}>{profile.name}</option>
						{/each}
					</select>
				</label>

				<div class="grid gap-2">
					<label class="flex flex-col">
						<span class="font-medium">Subfolder</span>
						<select name="folder" class="select-bordered select w-full">
							<option value="">No subfolder</option>
							{#each folders as folder}
								<option value={folder}>{folder}</option>
							{/each}
						</select>
					</label>
					<button type="button" class="btn btn-sm btn-outline" onclick={refreshFolders}>
						Refresh folders
					</button>
				</div>

				<!-- <label class="flex flex-col">
					<span class="font-medium">Qualität</span>
					<select name="quality" class="select-bordered select w-full">
						<option value="highest">Beste Qualität</option>
						<option value="lowest">Schlechteste Qualität</option>
					</select>
				</label> -->

				<label class="flex flex-col">
					<span class="font-medium">Optional Filename</span>
					<input
						name="filename"
						type="text"
						class="input-bordered input w-full"
						placeholder="My File (Episode 1)"
					/>
					<span class="text-sm text-gray-500">
						Allowed: letters, numbers, spaces, (), [], -, _ (max. 200)
					</span>
				</label>

				<label class="flex items-center gap-3">
					<input name="append_title" type="checkbox" class="checkbox" />
					<span>Append page title to filename</span>
				</label>

				<label class="flex items-center gap-3">
					<input
						name="advanced_enabled"
						type="checkbox"
						class="toggle"
						bind:checked={showAdvanced}
					/>
					<span>Advanced mode</span>
				</label>

				{#if showAdvanced}
					<div class="grid gap-4 rounded border border-base-300 p-4">
						<label class="flex items-center gap-3">
							<input name="embed_subtitles" type="checkbox" class="checkbox" />
							<span>Embed subtitles when available</span>
						</label>

						<label class="flex flex-col">
							<span class="font-medium">Retries</span>
							<input name="retries" type="number" min="0" class="input-bordered input w-full" />
						</label>

						<label class="flex flex-col">
							<span class="font-medium">Rate limit</span>
							<input name="rate_limit" type="text" class="input-bordered input w-full" placeholder="2M" />
						</label>

						<label class="flex flex-col">
							<span class="font-medium">Custom yt-dlp args</span>
							<input
								name="custom_args"
								type="text"
								class="input-bordered input w-full"
								placeholder="--cookies /config/cookies.txt"
							/>
						</label>
					</div>
				{/if}

				<button class="btn w-full btn-primary" type="submit">Add</button>
			</div>
		</form>
	{/if}

	{#if active === 'batch'}
		<form
			method="POST"
			action="?/importBatch"
			enctype="multipart/form-data"
			class="rounded-lg bg-base-100 p-6 shadow-lg"
			use:enhance
		>
			<div class="grid gap-4">
				<div>
					<label for="import_file" class="font-medium">Import File (.txt, TSV)</label>
					<input
						bind:this={fileInput}
						type="file"
						name="import_file"
						id="import_file"
						accept=".txt"
						class="file-input-bordered file-input mt-2 w-full"
						onchange={onFileChange}
					/>
				</div>

				<div>
					<label for="import_text" class="font-medium">Or paste TSV</label>
					<textarea
						name="import_text"
						id="import_text"
						rows={8}
						bind:value={importText}
						class="textarea-bordered textarea mt-2 w-full"
						placeholder={`https://example.com/video1\tMy Video 1`}
						oninput={(e) => updateFromTextarea(e.currentTarget.value)}
						onkeydown={handleTextareaKeydown}
					></textarea>
				</div>

				<label class="flex flex-col">
					<span class="font-medium">Download Profile</span>
					<select name="profile_id" class="select-bordered select w-full">
						{#each data.profiles as profile}
							<option value={profile.id} selected={profile.isDefault}>{profile.name}</option>
						{/each}
					</select>
				</label>

				<div class="grid gap-2">
					<label class="flex flex-col">
						<span class="font-medium">Subfolder</span>
						<select name="folder" class="select-bordered select w-full">
							<option value="">No subfolder</option>
							{#each folders as folder}
								<option value={folder}>{folder}</option>
							{/each}
						</select>
					</label>
					<button type="button" class="btn btn-sm btn-outline" onclick={refreshFolders}>
						Refresh folders
					</button>
				</div>

				{#if batchError}
					<div class="alert alert-warning">
						<span>{batchError}</span>
					</div>
				{/if}

				<div>
					<p class="font-medium">Preview</p>
					<div class="mt-2 max-h-56 overflow-auto rounded border p-2">
						{#if $preview.length === 0}
							<p class="text-sm text-gray-500">No valid entries.</p>
						{:else}
							<table class="table w-full">
								<thead>
									<tr>
										<th>#</th>
										<th>URL</th>
										<th>Filename</th>
									</tr>
								</thead>
								<tbody>
									{#each $preview as row, i}
										<tr>
											<th>{i + 1}</th>
											<td class="max-w-xs truncate">{row.url}</td>
											<td>{row.filename ?? '—'}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						{/if}
					</div>
				</div>

				<button class="btn w-full btn-primary" type="submit" disabled={!!batchError}>
					Import ({$preview.length})
				</button>
			</div>
		</form>
	{/if}
	{#if form?.error}
		<p class="w-full border border-error bg-error-content p-6 text-error">{form.error}</p>
	{/if}
</div>
