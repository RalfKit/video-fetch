import { json, type RequestHandler } from '@sveltejs/kit';
import { listDownloadFolders } from '$lib/server/folders';

export const GET: RequestHandler = async () => {
	return json({ folders: await listDownloadFolders() });
};
