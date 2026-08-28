import { json, type RequestHandler } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db/index';

/**
 * Lightweight application health check.
 *
 * Verifies only that the process is up and the local database is reachable and
 * queryable. It intentionally does not touch yt-dlp, ffmpeg, the network, or
 * perform any download, so it is safe to run frequently (e.g. Docker
 * HEALTHCHECK).
 */
export const GET: RequestHandler = async () => {
	try {
		db.get(sql`select 1`);
		return json({ status: 'ok', uptime: process.uptime() });
	} catch (err) {
		return json({ status: 'error', error: (err as Error).message }, { status: 503 });
	}
};
