import { describe, it, expect } from 'vitest';
import path from 'path';
import { sanitizeFilename, splitShellLikeArgs, resolveWithinRoot } from './utils';

describe('sanitizeFilename', () => {
	it('replaces forbidden filesystem characters', () => {
		expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
	});

	it('collapses whitespace and trims trailing dots/spaces', () => {
		expect(sanitizeFilename('  hello   world . ')).toBe('hello world');
	});

	it('falls back to "video" for empty results', () => {
		expect(sanitizeFilename('')).toBe('video');
		expect(sanitizeFilename('   ')).toBe('video');
		expect(sanitizeFilename('...')).toBe('video');
	});
});

describe('splitShellLikeArgs', () => {
	it('splits on unquoted whitespace', () => {
		expect(splitShellLikeArgs('--foo bar --baz')).toEqual(['--foo', 'bar', '--baz']);
	});

	it('keeps quoted segments together', () => {
		expect(splitShellLikeArgs('--name "hello world" --x \'a b\'')).toEqual([
			'--name',
			'hello world',
			'--x',
			'a b'
		]);
	});

	it('honours escaped characters', () => {
		expect(splitShellLikeArgs('a\\ b c')).toEqual(['a b', 'c']);
	});
});

describe('resolveWithinRoot (path traversal safety)', () => {
	const root = path.resolve('/downloads');

	it('resolves plain relative paths inside root', () => {
		expect(resolveWithinRoot(root, 'video.mp4')).toBe(path.join(root, 'video.mp4'));
		expect(resolveWithinRoot(root, 'creator/video.mp4')).toBe(
			path.join(root, 'creator', 'video.mp4')
		);
	});

	it('rejects parent-directory traversal', () => {
		expect(() => resolveWithinRoot(root, '../secret.txt')).toThrow();
		expect(() => resolveWithinRoot(root, 'a/../../secret.txt')).toThrow();
		expect(() => resolveWithinRoot(root, '../../etc/passwd')).toThrow();
	});

	it('rejects absolute path injection', () => {
		expect(() => resolveWithinRoot(root, '/etc/passwd')).toThrow();
	});

	it('does not treat a sibling directory with the same prefix as inside root', () => {
		// e.g. /downloads vs /downloads-evil
		const sibling = root + '-evil/file.txt';
		expect(() => resolveWithinRoot(root, sibling)).toThrow();
	});
});
