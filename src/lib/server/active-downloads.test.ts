import { describe, expect, it } from 'vitest';
import { isLiveDownloadUpdate, LIVE_UPDATE_WINDOW_MS } from './active-downloads';

const now = 10_000;

describe('isLiveDownloadUpdate', () => {
	it('keeps active jobs, including one stuck on downloading', () => {
		expect(isLiveDownloadUpdate({ status: 'downloading', finishedAt: null }, now)).toBe(true);
		expect(isLiveDownloadUpdate({ status: 'pending', finishedAt: null }, now)).toBe(true);
		expect(isLiveDownloadUpdate({ status: 'queued', finishedAt: null }, now)).toBe(true);
		expect(isLiveDownloadUpdate({ status: 'metadata_fetching', finishedAt: null }, now)).toBe(true);
	});

	it('drops a failed job once the short finish window has passed', () => {
		const recent = new Date(now - LIVE_UPDATE_WINDOW_MS + 1);
		const expired = new Date(now - LIVE_UPDATE_WINDOW_MS);

		expect(isLiveDownloadUpdate({ status: 'failed', finishedAt: recent }, now)).toBe(true);
		expect(isLiveDownloadUpdate({ status: 'failed', finishedAt: expired }, now)).toBe(false);
		expect(isLiveDownloadUpdate({ status: 'completed', finishedAt: expired }, now)).toBe(false);
		expect(isLiveDownloadUpdate({ status: 'cancelled', finishedAt: null }, now)).toBe(false);
	});
});
