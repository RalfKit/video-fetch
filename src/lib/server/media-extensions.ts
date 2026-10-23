import { sanitizeFilename } from './utils';

/**
 * Containers, manifests and audio suffixes treated as "this URL/file already
 * names the media". Page URLs are not in this set, so their query string stays.
 */
const MEDIA_EXTENSIONS = new Set([
	'm3u8',
	'mpd',
	'm3u',
	'f4m',
	'ism',
	'mp4',
	'm4v',
	'webm',
	'mkv',
	'mov',
	'ts',
	'flv',
	'avi',
	'wmv',
	'mpeg',
	'mpg',
	'm2ts',
	'mts',
	'3gp',
	'ogv',
	'f4v',
	'vob',
	'asf',
	'mp3',
	'm4a',
	'aac',
	'opus',
	'flac',
	'wav',
	'ogg',
	'wma'
]);

/** True when the last path segment ends in a direct media or manifest extension. */
export function isDirectMediaPath(pathname: string): boolean {
	const segment = pathname.split('/').pop() ?? '';
	const dot = segment.lastIndexOf('.');
	if (dot <= 0) return false;
	return MEDIA_EXTENSIONS.has(segment.slice(dot + 1).toLowerCase());
}

/** Removes one or more trailing media extensions. `Clip.mp4.MP4` becomes `Clip`. */
export function stripTrailingMediaExtensions(name: string): string {
	let current = name;
	for (;;) {
		const dot = current.lastIndexOf('.');
		if (dot <= 0) break;
		const ext = current.slice(dot + 1).toLowerCase();
		if (!MEDIA_EXTENSIONS.has(ext)) break;
		const next = current.slice(0, dot).replace(/[. ]+$/g, '');
		if (!next) break;
		current = next;
	}
	return current;
}

/**
 * Base name passed to yt-dlp before `.%(ext)s`.
 * A requested `Show.mp4` stays one extension, not `Show.mp4.mp4`.
 */
export function downloadOutputBase(name: string): string {
	const safe = sanitizeFilename(name);
	return stripTrailingMediaExtensions(safe) || safe;
}

/**
 * Duplicate key for a client-supplied filename.
 * Trimmed, case-insensitive, with repeated or trailing media extensions removed.
 * Empty input has no key (stored as NULL, and NULL does not collide).
 */
export function filenameKeyFor(input: string | null | undefined): string | null {
	if (input == null || !String(input).trim()) return null;
	const base = downloadOutputBase(String(input));
	const key = base.toLowerCase();
	return key || null;
}
