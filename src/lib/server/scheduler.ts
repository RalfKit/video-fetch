import { env } from '$env/dynamic/private';

export type ConcurrencyWindow = {
	start: string;
	end: string;
	concurrency: number;
};

export function parseConcurrencyWindows(input = env.CONCURRENCY_WINDOWS || '') {
	return input
		.split(',')
		.map((chunk) => chunk.trim())
		.filter(Boolean)
		.map((chunk) => {
			const [range, value] = chunk.split('=');
			const [start, end] = range.split('-');
			const concurrency = Number(value);
			if (!isTime(start) || !isTime(end) || !Number.isFinite(concurrency) || concurrency < 1) {
				return null;
			}
			return { start, end, concurrency: Math.floor(concurrency) };
		})
		.filter((window): window is ConcurrencyWindow => window !== null);
}

export function concurrencyForNow(
	windows: ConcurrencyWindow[],
	fallbackConcurrency: number,
	now = new Date()
) {
	const current = now.getHours() * 60 + now.getMinutes();
	const match = windows.find((window) => includesMinute(window, current));
	return match?.concurrency ?? fallbackConcurrency;
}

function includesMinute(window: ConcurrencyWindow, minute: number) {
	const start = toMinute(window.start);
	const end = toMinute(window.end);
	if (start <= end) return minute >= start && minute < end;
	return minute >= start || minute < end;
}

function toMinute(value: string) {
	const [hours, minutes] = value.split(':').map(Number);
	return hours * 60 + minutes;
}

function isTime(value?: string) {
	return !!value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
