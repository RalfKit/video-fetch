import fs from 'fs';
import path from 'path';
import { error, type RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/index';
import { downloads } from '$lib/server/db/schema';
import { DOWNLOAD_FOLDER } from '$lib/server/config';

export const GET: RequestHandler = async ({ params }) => {
	if (!params.id) throw error(404, 'Media not found');

	const [download] = await db
		.select()
		.from(downloads)
		.where(eq(downloads.id, params.id))
		.limit(1);

	if (!download?.filePath) throw error(404, 'Media not found');

	const absolutePath = path.resolve(DOWNLOAD_FOLDER, download.filePath);
	const root = path.resolve(DOWNLOAD_FOLDER);
	if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
		throw error(403, 'Invalid media path');
	}
	if (!fs.existsSync(absolutePath)) throw error(404, 'Media not found');

	const stream = fs.createReadStream(absolutePath);
	const ext = path.extname(absolutePath).toLowerCase();

	return new Response(stream as unknown as BodyInit, {
		headers: {
			'Content-Type': contentType(ext),
			'Content-Disposition': `inline; filename="${path.basename(absolutePath).replaceAll('"', '')}"`
		}
	});
};

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
