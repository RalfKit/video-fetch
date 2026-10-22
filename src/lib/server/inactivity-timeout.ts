/** Default silence window before a download is stopped. Five minutes. */
export const DEFAULT_DOWNLOAD_INACTIVITY_TIMEOUT_MS = 300_000;

/**
 * Parse `DOWNLOAD_INACTIVITY_TIMEOUT` (seconds).
 *
 * Empty uses the default. `0`, `off`, `false`, or `no` disables the watchdog.
 * Anything else that is not a positive integer is a configuration error.
 */
export function parseInactivityTimeoutMs(raw: string | undefined | null): number {
	const value = (raw ?? '').trim();
	if (!value) return DEFAULT_DOWNLOAD_INACTIVITY_TIMEOUT_MS;
	if (/^(0|off|false|no)$/i.test(value)) return 0;
	if (!/^[1-9]\d*$/.test(value)) {
		throw new Error(
			`Invalid DOWNLOAD_INACTIVITY_TIMEOUT "${raw}". Use a positive number of seconds, or 0 to disable.`
		);
	}
	return Number(value) * 1000;
}

export function inactivityFailureMessage(timeoutMs: number, processStarted: boolean): string {
	const waited = timeoutMs % 1000 === 0 ? `${timeoutMs / 1000}s` : `${timeoutMs}ms`;
	const why = processStarted
		? `Download stalled: yt-dlp produced no output for ${waited}.`
		: `Download never started: yt-dlp produced no output for ${waited}.`;
	return `${why} The process was stopped (DOWNLOAD_INACTIVITY_TIMEOUT).`;
}
