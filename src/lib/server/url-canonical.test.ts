import { describe, expect, it } from 'vitest';
import { canonicalVideoUrl, mediaKeyFor } from './url-canonical';

const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

describe('canonicalVideoUrl', () => {
	it('folds YouTube spellings of the same video into one URL', () => {
		const forms = [
			'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			'https://youtube.com/watch?v=dQw4w9WgXcQ',
			'http://youtube.com/watch?v=dQw4w9WgXcQ',
			'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
			'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
			'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
			'https://youtu.be/dQw4w9WgXcQ',
			'https://www.youtu.be/dQw4w9WgXcQ?si=abc&t=43',
			'https://www.youtube.com/shorts/dQw4w9WgXcQ',
			'https://www.youtube.com/live/dQw4w9WgXcQ',
			'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2&feature=share&pp=xyz&t=12s',
			'https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ',
			'https://www.youtube.com/attribution_link?a=XXX&u=%2Fwatch%3Fv%3DdQw4w9WgXcQ%26feature%3Dshare'
		];

		for (const form of forms) {
			expect(canonicalVideoUrl(form), form).toBe(YOUTUBE);
		}
	});

	it('keeps two different YouTube videos apart', () => {
		expect(canonicalVideoUrl('https://youtu.be/abcdefghijk')).not.toBe(
			canonicalVideoUrl('https://www.youtube.com/watch?v=ZYXWVUTSRQP')
		);
	});

	it('preserves YouTube id case', () => {
		expect(canonicalVideoUrl('https://youtu.be/dQw4w9WgXcQ')).not.toBe(
			canonicalVideoUrl('https://youtu.be/dqw4w9wgxcq')
		);
	});

	it('does not treat a playlist-only YouTube URL as a video', () => {
		const playlist = canonicalVideoUrl(
			'https://www.youtube.com/playlist?list=PLabc&feature=share&si=zzz'
		);
		expect(playlist).toBe('https://youtube.com/playlist?list=PLabc');
		expect(playlist).not.toBe(YOUTUBE);
	});

	it('folds Vimeo player and website URLs', () => {
		expect(canonicalVideoUrl('https://vimeo.com/123456789')).toBe('https://vimeo.com/123456789');
		expect(canonicalVideoUrl('https://player.vimeo.com/video/123456789?h=abc')).toBe(
			'https://vimeo.com/123456789'
		);
		expect(canonicalVideoUrl('https://vimeo.com/channels/staffpicks/123456789')).toBe(
			'https://vimeo.com/123456789'
		);
	});

	it('strips tracking noise from other sites without merging different files', () => {
		expect(canonicalVideoUrl('https://www.Example.com/watch/a/?utm_source=nl&fbclid=1')).toBe(
			canonicalVideoUrl('https://example.com/watch/a')
		);

		expect(canonicalVideoUrl('https://cdn.example.com/a.m3u8?token=one&i=185')).not.toBe(
			canonicalVideoUrl('https://cdn.example.com/b.m3u8?token=two&i=185')
		);
		expect(canonicalVideoUrl('https://cdn.example.com/a.mp4?sig=aaa')).toBe(
			canonicalVideoUrl('https://cdn.example.com/a.mp4?sig=bbb')
		);
		expect(canonicalVideoUrl('https://cdn.example.com/a.mp4?sig=aaa')).toBe(
			'https://cdn.example.com/a.mp4'
		);
	});

	it('drops the signed query on direct media and keeps it on page URLs', () => {
		const path =
			'https://cdn.example.test/engine/hls2-c/01/18138/episode_,h,n,l,.urlset/master.m3u8';
		const tokenA = `${path}?t=fakeTokenA&s=100&e=14400&rq=fakeRqA#t=12`;
		const tokenB = `${path}?t=fakeTokenB&s=103&e=14400&rq=fakeRqB`;
		expect(canonicalVideoUrl(tokenA)).toBe(path);
		expect(canonicalVideoUrl(tokenB)).toBe(path);

		expect(canonicalVideoUrl('https://videos.example.test/watch?id=episode-6')).not.toBe(
			canonicalVideoUrl('https://videos.example.test/watch?id=episode-7')
		);
		expect(canonicalVideoUrl('https://videos.example.test/watch?id=episode-6&utm_source=x')).toBe(
			'https://videos.example.test/watch?id=episode-6'
		);
	});

	it('ignores fragments, default ports, trailing slashes and query order', () => {
		expect(canonicalVideoUrl('https://example.com:443/file/?b=2&a=1#t=10')).toBe(
			'https://example.com/file?a=1&b=2'
		);
		expect(canonicalVideoUrl('https://example.com/file/')).toBe('https://example.com/file');
	});
});

describe('mediaKeyFor', () => {
	it('keys reliable extractor ids and ignores generic ones', () => {
		expect(mediaKeyFor('YouTube', 'dQw4w9WgXcQ')).toBe('youtube\u001fdQw4w9WgXcQ');
		expect(mediaKeyFor('generic', 'zo=&i=185')).toBeNull();
		expect(mediaKeyFor('generic', 'master.m3u8?t=fakeTokenA&s=100')).toBeNull();
		expect(mediaKeyFor('vimeo', '123')).not.toBe(mediaKeyFor('youtube', '123'));
	});
});
