import type { ServerInit } from '@sveltejs/kit';
import { initializeServer, shutdownServer } from '$lib/server/store';

let shutdownHooksRegistered = false;

/**
 * SvelteKit server `init` hook.
 *
 * Runs exactly once after the whole server module graph has been evaluated and
 * before the first request is handled. This is the safe place to start the
 * download queue and subscription scheduler: doing it here avoids the
 * import-cycle initialization crash that occurred when startup ran as a
 * module-load side effect.
 */
export const init: ServerInit = async () => {
	await initializeServer();

	if (!shutdownHooksRegistered) {
		shutdownHooksRegistered = true;
		const onShutdown = () => shutdownServer();
		process.once('SIGTERM', onShutdown);
		process.once('SIGINT', onShutdown);
	}
};
