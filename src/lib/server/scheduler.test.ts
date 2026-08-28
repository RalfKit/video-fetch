import { describe, it, expect } from 'vitest';
import { parseConcurrencyWindows, concurrencyForNow } from './scheduler';

describe('parseConcurrencyWindows', () => {
	it('parses a single valid window', () => {
		expect(parseConcurrencyWindows('01:00-05:00=5')).toEqual([
			{ start: '01:00', end: '05:00', concurrency: 5 }
		]);
	});

	it('parses multiple windows', () => {
		expect(parseConcurrencyWindows('01:00-05:00=5, 05:00-01:00=1')).toEqual([
			{ start: '01:00', end: '05:00', concurrency: 5 },
			{ start: '05:00', end: '01:00', concurrency: 1 }
		]);
	});

	it('drops invalid entries (bad time / non-positive concurrency)', () => {
		expect(parseConcurrencyWindows('99:99-05:00=5')).toEqual([]);
		expect(parseConcurrencyWindows('01:00-05:00=0')).toEqual([]);
		expect(parseConcurrencyWindows('garbage')).toEqual([]);
		expect(parseConcurrencyWindows('')).toEqual([]);
	});
});

describe('concurrencyForNow', () => {
	const windows = parseConcurrencyWindows('01:00-05:00=5');

	it('uses the window value inside the window', () => {
		const inside = new Date();
		inside.setHours(3, 0, 0, 0);
		expect(concurrencyForNow(windows, 1, inside)).toBe(5);
	});

	it('uses the fallback outside the window', () => {
		const outside = new Date();
		outside.setHours(12, 0, 0, 0);
		expect(concurrencyForNow(windows, 1, outside)).toBe(1);
	});

	it('supports windows that wrap past midnight', () => {
		const wrap = parseConcurrencyWindows('22:00-02:00=3');
		const late = new Date();
		late.setHours(23, 30, 0, 0);
		const early = new Date();
		early.setHours(1, 0, 0, 0);
		expect(concurrencyForNow(wrap, 1, late)).toBe(3);
		expect(concurrencyForNow(wrap, 1, early)).toBe(3);
	});

	it('returns the fallback when there are no windows', () => {
		expect(concurrencyForNow([], 2)).toBe(2);
	});
});
