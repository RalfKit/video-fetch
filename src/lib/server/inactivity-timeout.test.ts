import { describe, expect, it } from 'vitest';
import {
	DEFAULT_DOWNLOAD_INACTIVITY_TIMEOUT_MS,
	inactivityFailureMessage,
	parseInactivityTimeoutMs
} from './inactivity-timeout';

describe('parseInactivityTimeoutMs', () => {
	it('uses five minutes when unset', () => {
		expect(parseInactivityTimeoutMs(undefined)).toBe(DEFAULT_DOWNLOAD_INACTIVITY_TIMEOUT_MS);
		expect(parseInactivityTimeoutMs('')).toBe(300_000);
		expect(parseInactivityTimeoutMs('   ')).toBe(300_000);
	});

	it('accepts a positive number of seconds', () => {
		expect(parseInactivityTimeoutMs('15')).toBe(15_000);
		expect(parseInactivityTimeoutMs(' 300 ')).toBe(300_000);
	});

	it('treats 0 and off as disabled', () => {
		expect(parseInactivityTimeoutMs('0')).toBe(0);
		expect(parseInactivityTimeoutMs('off')).toBe(0);
		expect(parseInactivityTimeoutMs('false')).toBe(0);
		expect(parseInactivityTimeoutMs('no')).toBe(0);
	});

	it('rejects values that are not a whole number of seconds', () => {
		expect(() => parseInactivityTimeoutMs('1.5')).toThrow(/DOWNLOAD_INACTIVITY_TIMEOUT/);
		expect(() => parseInactivityTimeoutMs('-1')).toThrow(/DOWNLOAD_INACTIVITY_TIMEOUT/);
		expect(() => parseInactivityTimeoutMs('abc')).toThrow(/DOWNLOAD_INACTIVITY_TIMEOUT/);
	});
});

describe('inactivityFailureMessage', () => {
	it('distinguishes a process that never started from one that went quiet', () => {
		expect(inactivityFailureMessage(300_000, false)).toContain('never started');
		expect(inactivityFailureMessage(300_000, true)).toContain('stalled');
		expect(inactivityFailureMessage(400, false)).toContain('400ms');
	});
});
