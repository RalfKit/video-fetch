/**
 * Stable URL identity for duplicate detection.
 *
 * YouTube and Vimeo links are reduced to the video id so common spellings
 * (`youtu.be`, shorts, mobile, tracking params) collide. Other sites only lose
 * fragments, default ports, a leading `www.`, a trailing slash and known
 * tracking parameters. Signed query values stay, so unrelated CDN URLs are not
 * folded together.
 */

import { reliableExtractorVideoId } from './media-identity';

const YT_ID = /^[a-zA-Z0-9_-]{11}$/;

const YOUTUBE_HOSTS = new Set([
	'youtube.com',
	'm.youtube.com',
	'music.youtube.com',
	'youtube-nocookie.com',
	'youtu.be'
]);

/** Dropped from YouTube URLs that are not a single video (playlists, channels). */
const YOUTUBE_NOISE = new Set([
	'si',
	'feature',
	'pp',
	'ab_channel',
	't',
	'time_continue',
	'start_radio',
	'index',
	'app',
	'src',
	'source',
	'ucbcb',
	'shares',
	'kw',
	'persist_app',
	'bpctr',
	'has_verified'
]);

const GENERIC_TRACKING = new Set([
	'fbclid',
	'gclid',
	'dclid',
	'gbraid',
	'wbraid',
	'mc_cid',
	'mc_eid',
	'igshid',
	'igsh',
	'mkt_tok',
	'ref_src',
	'ref_url',
	'yclid',
	'_ga',
	'_gl',
	'fb_action_ids',
	'fb_action_types',
	'fb_source',
	'vero_conv',
	'vero_id',
	'ncid',
	'srsltid'
]);

const YOUTUBE_PATH_PREFIXES = new Set(['shorts', 'embed', 'live', 'v', 'e']);

function hostname(url: URL): string {
	return url.hostname.toLowerCase().replace(/^www\./, '');
}

function isGenericTracking(name: string): boolean {
	const key = name.toLowerCase();
	return key.startsWith('utm_') || GENERIC_TRACKING.has(key);
}

function youtubeVideoId(url: URL, depth = 0): string | null {
	const host = hostname(url);
	if (!YOUTUBE_HOSTS.has(host) || depth > 1) return null;

	if (host !== 'youtu.be' && url.pathname === '/attribution_link') {
		const embedded = url.searchParams.get('u');
		if (!embedded) return null;
		try {
			return youtubeVideoId(new URL(embedded, 'https://www.youtube.com'), depth + 1);
		} catch {
			return null;
		}
	}

	if (host === 'youtu.be') {
		const [id = ''] = url.pathname.split('/').filter(Boolean);
		return YT_ID.test(id) ? id : null;
	}

	const parts = url.pathname.split('/').filter(Boolean);
	if (parts[0] === 'watch') {
		const fromQuery = url.searchParams.get('v')?.trim() ?? '';
		if (YT_ID.test(fromQuery)) return fromQuery;
		if (parts[1] && YT_ID.test(parts[1])) return parts[1];
		return null;
	}

	if (YOUTUBE_PATH_PREFIXES.has(parts[0] ?? '') && parts[1] && YT_ID.test(parts[1])) {
		return parts[1];
	}

	return null;
}

function vimeoVideoId(url: URL): string | null {
	const host = hostname(url);
	const parts = url.pathname.split('/').filter(Boolean);

	if (host === 'player.vimeo.com') {
		if (parts[0] === 'video' && parts[1] && /^\d+$/.test(parts[1])) return parts[1];
		return null;
	}

	if (host !== 'vimeo.com') return null;
	const numeric = parts.filter((part) => /^\d{5,}$/.test(part));
	return numeric.at(-1) ?? null;
}

function genericCanonical(input: string, extraDrop?: Set<string>): string | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

	url.hash = '';
	url.hostname = hostname(url);
	if (url.port === '443' || url.port === '80') url.port = '';

	for (const key of [...url.searchParams.keys()]) {
		if (isGenericTracking(key) || extraDrop?.has(key.toLowerCase())) url.searchParams.delete(key);
	}
	url.searchParams.sort();

	if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');

	if (url.pathname === '/') return `${url.protocol}//${url.host}${url.search}`;
	return url.toString();
}

/**
 * Canonical form of a download URL, or `null` when the input is not an http(s) URL.
 */
export function canonicalVideoUrl(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return null;
	}

	const youtubeId = youtubeVideoId(url);
	if (youtubeId) return `https://www.youtube.com/watch?v=${youtubeId}`;

	const vimeoId = vimeoVideoId(url);
	if (vimeoId) return `https://vimeo.com/${vimeoId}`;

	const extra = YOUTUBE_HOSTS.has(hostname(url)) ? YOUTUBE_NOISE : undefined;
	return genericCanonical(trimmed, extra);
}

/**
 * Stable `extractor + id` key. `null` for missing or unreliable (generic) ids,
 * which must not be used as a global identity.
 */
export function mediaKeyFor(extractor?: string | null, videoId?: string | null): string | null {
	const id = reliableExtractorVideoId(extractor, videoId);
	if (!extractor || !id) return null;
	return `${extractor.trim().toLowerCase()}\u001f${id}`;
}
