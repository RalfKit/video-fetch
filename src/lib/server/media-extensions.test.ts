import { describe, expect, it } from 'vitest';
import { downloadOutputBase, filenameKeyFor } from './media-extensions';

const REQUESTED = 'Tomb.Raider.King.S01E06.German.1080p.AAC.WebRip.x264-GSD.mp4';

describe('filenameKeyFor', () => {
	it('folds case and a repeated media extension', () => {
		expect(filenameKeyFor(REQUESTED)).toBe(
			'tomb.raider.king.s01e06.german.1080p.aac.webrip.x264-gsd'
		);
		expect(filenameKeyFor(`  ${REQUESTED.toUpperCase()}.MP4  `)).toBe(filenameKeyFor(REQUESTED));
		expect(filenameKeyFor('  ')).toBeNull();
		expect(filenameKeyFor(null)).toBeNull();
	});
});

describe('downloadOutputBase', () => {
	it('does not keep an extension that yt-dlp would append again', () => {
		expect(downloadOutputBase(REQUESTED)).toBe(
			'Tomb.Raider.King.S01E06.German.1080p.AAC.WebRip.x264-GSD'
		);
		expect(downloadOutputBase(`${REQUESTED}.mp4`)).toBe(
			'Tomb.Raider.King.S01E06.German.1080p.AAC.WebRip.x264-GSD'
		);
		expect(downloadOutputBase('clip')).toBe('clip');
	});
});
