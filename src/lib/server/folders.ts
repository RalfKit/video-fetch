import fs from 'fs/promises';
import path from 'path';
import { DOWNLOAD_FOLDER } from './config';

const MAX_DEPTH = 4;

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
