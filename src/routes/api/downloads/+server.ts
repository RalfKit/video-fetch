import type { RequestHandler } from '@sveltejs/kit';
import { downloads } from '$lib/server/store';
import { isLiveDownloadUpdate } from '$lib/server/active-downloads';
import { get } from 'svelte/store';
import type { DownloadUpdate } from '$lib/types/download';

export const GET: RequestHandler = ({ request }) => {
	let closed = false;

	const stream = new ReadableStream({
		start(controller) {
			const interval = setInterval(() => {
				if (closed) return;

				const now = Date.now();

				// Active jobs, plus ones that finished in the last couple of seconds.
				const activeDownloads: DownloadUpdate[] = get(downloads)
					.filter((d) => isLiveDownloadUpdate(d, now))
					.map((d) => ({
						id: d.id,
						videoUrl: d.videoUrl,
						fileName: d.fileName,
						status: d.status,
						errorMessage: d.errorMessage,
						progress: d.progress,
						title: d.title,
						thumbnailUrl: d.thumbnailUrl,
						filePath: d.filePath,
						folder: d.folder,
						createdAt: d.createdAt,
						finishedAt: d.finishedAt
					}));

				if (activeDownloads.length === 0) return; // nichts senden, kein Download aktiv

				try {
					controller.enqueue(`data: ${JSON.stringify(activeDownloads)}\n\n`);
				} catch {
					// Controller evtl. schon geschlossen
					clearInterval(interval);
				}
			}, 1000);

			const closeStream = () => {
				if (closed) return;
				closed = true;
				clearInterval(interval);

				try {
					controller.close();
				} catch {
					// Controller evtl. schon geschlossen – safe ignorieren
				}
			};

			// Client trennt Verbindung (Reload, Tab schließen, etc.)
			request.signal.addEventListener('abort', closeStream, { once: true });
		},

		cancel() {
			// Safety: falls ReadableStream von intern abgebrochen wird
			closed = true;
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
