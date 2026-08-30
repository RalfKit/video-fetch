import fs from 'fs';
import path from 'path';
import { error, type RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { downloads } from '$lib/server/db/schema';
import { resolveWithinDownloadFolder } from '$lib/server/folders';

export const GET: RequestHandler = async ({ params, request }) => {
	if (!params.id) throw error(404, 'Media not found');

	const [download] = await db.select().from(downloads).where(eq(downloads.id, params.id)).limit(1);

	if (!download?.filePath) throw error(404, 'Media not found');

	let absolutePath: string;
	try {
		absolutePath = resolveWithinDownloadFolder(download.filePath);
	} catch {
		throw error(403, 'Invalid media path');
	}

	let stat: fs.Stats;
	try {
		stat = fs.statSync(absolutePath);
	} catch {
		throw error(404, 'Media not found');
	}
	if (!stat.isFile()) throw error(404, 'Media not found');

	const size = stat.size;
	const fileName = path.basename(absolutePath).replaceAll('"', '');
	const headers: Record<string, string> = {
		'Content-Type': contentType(path.extname(absolutePath).toLowerCase()),
		'Content-Disposition': `inline; filename="${fileName}"`,
		// Advertise range support so browsers can seek within the media.
		'Accept-Ranges': 'bytes'
	};

	const range = parseRange(request.headers.get('range'), size);

	// Unsatisfiable range → 416 with the current size.
	if (range === 'invalid') {
		return new Response(null, {
			status: 416,
			headers: { ...headers, 'Content-Range': `bytes */${size}` }
		});
	}

	// Partial content: stream only the requested byte range so seeking works.
	if (range) {
		const { start, end } = range;
		const stream = fs.createReadStream(absolutePath, { start, end });
		return new Response(stream as unknown as BodyInit, {
			status: 206,
			headers: {
				...headers,
				'Content-Range': `bytes ${start}-${end}/${size}`,
				'Content-Length': String(end - start + 1)
			}
		});
	}

	// Full response with an explicit length so the browser knows the duration.
	const stream = fs.createReadStream(absolutePath);
	return new Response(stream as unknown as BodyInit, {
		status: 200,
		headers: { ...headers, 'Content-Length': String(size) }
	});
};

/**
 * Parses a single HTTP `Range` header against the file size.
 *
 * Returns the resolved `{ start, end }` (inclusive) for a satisfiable range,
 * `'invalid'` for a syntactically valid but unsatisfiable range (→ 416), or
 * `null` when no/unsupported range was requested (→ full response).
 */
function parseRange(
	header: string | null,
	size: number
): { start: number; end: number } | 'invalid' | null {
	if (!header) return null;

	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match) return null;

	const [, startStr, endStr] = match;
	if (startStr === '' && endStr === '') return null;

	let start: number;
	let end: number;

	if (startStr === '') {
		// Suffix range: the final N bytes.
		const suffixLength = Number(endStr);
		if (!Number.isFinite(suffixLength) || suffixLength <= 0) return 'invalid';
		start = Math.max(0, size - suffixLength);
		end = size - 1;
	} else {
		start = Number(startStr);
		end = endStr === '' ? size - 1 : Number(endStr);
	}

	if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
	if (end >= size) end = size - 1;
	if (start < 0 || start > end || start >= size) return 'invalid';

	return { start, end };
}

function contentType(ext: string) {
	switch (ext) {
		case '.mp4':
			return 'video/mp4';
		case '.webm':
			return 'video/webm';
		case '.mkv':
			return 'video/x-matroska';
		case '.mp3':
			return 'audio/mpeg';
		case '.m4a':
			return 'audio/mp4';
		case '.opus':
			return 'audio/ogg';
		default:
			return 'application/octet-stream';
	}
}
