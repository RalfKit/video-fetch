import fs from 'fs';
import path from 'path';
import { YtDlp } from 'ytdlp-nodejs';
import { env } from '$env/dynamic/private';

/**
 * Resolves an external binary path in a way that works across environments
 * (local dev on Linux/macOS/Windows, Docker/production, Cloud agents):
 *
 * 1. An explicit path from an environment variable always wins.
 * 2. Otherwise a well-known install location is used if it actually exists
 *    (this matches the production Docker image at `/usr/local/bin`).
 * 3. Otherwise `undefined` is returned so `ytdlp-nodejs` falls back to its own
 *    bundled binary / a `PATH` lookup for ffmpeg.
 *
 * The previous implementation hard-coded Windows `.exe` paths for dev, which
 * broke on Linux/macOS and required per-machine workarounds.
 */
function resolveBinary(
	explicit: string | undefined,
	...knownLocations: string[]
): string | undefined {
	const configured = explicit?.trim();
	if (configured) return path.resolve(configured);

	for (const location of knownLocations) {
		if (location && fs.existsSync(location)) return location;
	}

	return undefined;
}

const binaryPath = resolveBinary(env.YTDLP_PATH, '/usr/local/bin/yt-dlp');
const ffmpegPath = resolveBinary(env.FFMPEG_PATH, '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg');

const options: { binaryPath?: string; ffmpegPath?: string } = {};
if (binaryPath) options.binaryPath = binaryPath;
if (ffmpegPath) options.ffmpegPath = ffmpegPath;

export const ytdlp = new YtDlp(options);
