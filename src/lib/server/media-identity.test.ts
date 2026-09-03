import { describe, it, expect } from 'vitest';
import { isReliableMediaIdentity, reliableExtractorVideoId } from './media-identity';

describe('media identity (duplicate detection)', () => {
	describe('regression: generic extractor id collisions must not be treated as identity', () => {
		// The concrete bug found in the database:
		//   Video A: generic + "zo=&i=185"  → Dungeon of Black Company S01E07
		//   Video B: generic + "zo=&i=185"  → Demon Lord Retry S01E05
		// These are DIFFERENT videos and must never be considered duplicates.
		const A = { extractor: 'generic', id: 'zo=&i=185', title: 'Dungeon of Black Company S01E07' };
		const B = { extractor: 'generic', id: 'zo=&i=185', title: 'Demon Lord Retry S01E05' };

		it('does not treat the shared generic id as a reliable identity', () => {
			expect(isReliableMediaIdentity(A.extractor, A.id)).toBe(false);
			expect(isReliableMediaIdentity(B.extractor, B.id)).toBe(false);
		});

		it('never derives a stored identity from the generic id', () => {
			// Both resolve to null → there is no identity to match on, so the two
			// different videos cannot be detected as duplicates of each other.
			expect(reliableExtractorVideoId(A.extractor, A.id)).toBeNull();
			expect(reliableExtractorVideoId(B.extractor, B.id)).toBeNull();
		});
	});

	describe('other unstable generic / M3U8 / CDN ids', () => {
		const cases = [
			'index-v1-a1.m3u8?token=abc&i=185',
			'zo=&i=185',
			'chunklist_b1234567.m3u8',
			'hls/stream?sig=deadbeef',
			'video?token=xyz'
		];

		for (const id of cases) {
			it(`treats generic id ${JSON.stringify(id)} as unreliable`, () => {
				expect(isReliableMediaIdentity('generic', id)).toBe(false);
				expect(reliableExtractorVideoId('generic', id)).toBeNull();
			});
		}

		it('is case-insensitive about the generic extractor name', () => {
			expect(isReliableMediaIdentity('Generic', 'zo=&i=185')).toBe(false);
			expect(isReliableMediaIdentity('  GENERIC  ', 'zo=&i=185')).toBe(false);
		});
	});

	describe('reliable site extractors keep working', () => {
		it('accepts real extractor ids as a stable identity', () => {
			expect(isReliableMediaIdentity('youtube', 'dQw4w9WgXcQ')).toBe(true);
			expect(reliableExtractorVideoId('youtube', 'dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
			expect(isReliableMediaIdentity('vimeo', '123456789')).toBe(true);
			expect(reliableExtractorVideoId('vimeo', '123456789')).toBe('123456789');
		});

		it('distinguishes different ids on the same real extractor', () => {
			expect(reliableExtractorVideoId('youtube', 'aaa')).not.toBe(
				reliableExtractorVideoId('youtube', 'bbb')
			);
		});
	});

	describe('missing / empty values', () => {
		it('requires both a non-empty extractor and id', () => {
			expect(isReliableMediaIdentity(null, 'x')).toBe(false);
			expect(isReliableMediaIdentity('youtube', null)).toBe(false);
			expect(isReliableMediaIdentity('', '')).toBe(false);
			expect(isReliableMediaIdentity('youtube', '   ')).toBe(false);
			expect(reliableExtractorVideoId(null, null)).toBeNull();
		});
	});
});
