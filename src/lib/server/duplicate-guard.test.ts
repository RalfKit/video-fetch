import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
	alreadyInListMessage,
	classifyDuplicateMatches,
	isUniqueConstraintError,
	preferDuplicateRow
} from './duplicate-guard';

describe('duplicate policy', () => {
	it('points at the existing entry and explains a completed re-download', () => {
		const message = alreadyInListMessage({
			id: 'abc',
			title: 'Same title',
			fileName: null,
			videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
			status: 'completed'
		});

		expect(message).toContain('Already in the list');
		expect(message).toContain('Same title');
		expect(message).toContain('/video/abc');
		expect(message).toContain('Remove that entry');
	});

	it('prefers an in-progress row over a completed one, and a file over an empty completed row', () => {
		const pending = { id: 'pending', status: 'pending', updatedAt: 1 };
		const completed = { id: 'done', status: 'completed', filePath: '/v.mp4', finishedAt: 50 };
		const completedEmpty = { id: 'empty', status: 'completed', filePath: null, finishedAt: 80 };
		const failed = { id: 'failed', status: 'failed', updatedAt: 100 };

		expect(preferDuplicateRow([completed, pending, failed]).id).toBe('pending');
		expect(preferDuplicateRow([completedEmpty, completed]).id).toBe('done');
		expect(preferDuplicateRow([failed, { id: 'older', status: 'failed', updatedAt: 1 }]).id).toBe(
			'failed'
		);
	});

	it('rejects active and completed rows and retries failed or cancelled ones', () => {
		expect(classifyDuplicateMatches([]).kind).toBe('insert');
		expect(classifyDuplicateMatches([{ id: '1', status: 'downloading' }])).toMatchObject({
			kind: 'reject',
			existing: { id: '1' }
		});
		expect(classifyDuplicateMatches([{ id: '1', status: 'completed' }]).kind).toBe('reject');
		expect(classifyDuplicateMatches([{ id: '1', status: 'failed' }]).kind).toBe('retry');
		expect(classifyDuplicateMatches([{ id: '1', status: 'cancelled' }]).kind).toBe('retry');
		expect(
			classifyDuplicateMatches([
				{ id: 'failed', status: 'failed' },
				{ id: 'done', status: 'completed' }
			])
		).toMatchObject({ kind: 'reject', existing: { id: 'done' } });
	});

	it('recognizes a SQLite unique-constraint failure', () => {
		const database = new Database(':memory:');
		database.exec('CREATE TABLE t (id text primary key, canonical_url text)');
		database.exec('CREATE UNIQUE INDEX u ON t (canonical_url)');
		database.prepare('INSERT INTO t (id, canonical_url) VALUES (?, ?)').run('1', 'same');

		let caught: unknown;
		try {
			database.prepare('INSERT INTO t (id, canonical_url) VALUES (?, ?)').run('2', 'same');
		} catch (err) {
			caught = err;
		}

		expect(isUniqueConstraintError(caught)).toBe(true);
		expect(isUniqueConstraintError(new Error('nope'))).toBe(false);
		database.close();
	});
});
