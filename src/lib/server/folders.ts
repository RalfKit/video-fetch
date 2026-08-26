import fs from 'fs/promises';
import path from 'path';
import { DOWNLOAD_FOLDER } from './config';
import { resolveWithinRoot } from './utils';

const MAX_DEPTH = 4;

/**
 * Resolves a stored relative media path to an absolute path that is guaranteed
 * to live inside `DOWNLOAD_FOLDER`. Throws if the path would escape the folder.
 */
export function resolveWithinDownloadFolder(relativePath: string): string {
	return resolveWithinRoot(DOWNLOAD_FOLDER, relativePath);
}

/**
 * Deletes a downloaded file identified by its stored relative path.
 *
 * Path traversal / absolute paths are rejected so only files inside
 * `DOWNLOAD_FOLDER` can ever be removed. Refuses to operate on the download
 * root itself. Missing files are ignored.
 */
export async function deleteDownloadFile(relativePath: string): Promise<void> {
	const trimmed = (relativePath ?? '').trim();
	if (!trimmed) return;

	const absolute = resolveWithinDownloadFolder(trimmed);
	const root = path.resolve(DOWNLOAD_FOLDER);
	if (absolute === root) throw new Error('Refusing to delete the download root directory');

	await fs.rm(absolute, { force: true });
}

export function sanitizeFolder(input?: string | null): string | null {
	if (!input) return null;

	const normalized = input.replaceAll('\\', '/').split('/').filter(Boolean).join('/');
	if (!normalized || normalized === '.') return null;
	if (path.isAbsolute(normalized)) throw new Error('Absolute paths are not allowed');

	const parts = normalized.split('/');
	if (parts.some((part) => part === '..' || part.includes('\0'))) {
		throw new Error('Invalid folder path');
	}

	return parts.join('/');
}

export function resolveDownloadFolder(folder?: string | null) {
	const safeFolder = sanitizeFolder(folder);
	const resolved = safeFolder ? path.resolve(DOWNLOAD_FOLDER, safeFolder) : DOWNLOAD_FOLDER;
	const root = path.resolve(DOWNLOAD_FOLDER);

	if (resolved !== root && !resolved.startsWith(root + path.sep)) {
		throw new Error('Folder escapes download path');
	}

	return resolved;
}

export async function ensureExistingDownloadFolder(folder?: string | null) {
	const resolved = resolveDownloadFolder(folder);
	const stat = await fs.stat(resolved);
	if (!stat.isDirectory()) throw new Error('Selected folder is not a directory');
	return resolved;
}

export async function listDownloadFolders() {
	const result: string[] = [];

	async function walk(current: string, depth: number) {
		if (depth > MAX_DEPTH) return;

		const entries = await fs.readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

			const absolute = path.join(current, entry.name);
			const relative = path.relative(DOWNLOAD_FOLDER, absolute).replaceAll(path.sep, '/');
			result.push(relative);
			await walk(absolute, depth + 1);
		}
	}

	await walk(DOWNLOAD_FOLDER, 1);
	return result.sort((a, b) => a.localeCompare(b));
}
