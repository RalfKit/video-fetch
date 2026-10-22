import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloads as downloadsSchema, type DownloadAdd } from './db/schema';

const paths = vi.hoisted(() => {
	const root = `/tmp/vf-dup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	return {
		root,
		dbPath: `${root}/downloads.db`,
		downloadPath: `${root}/downloads`,
		tempPath: `${root}/incomplete`
	};
});

vi.mock('$env/dynamic/private', () => ({
	env: {
		DATABASE_PATH: paths.dbPath,
		DOWNLOAD_PATH: paths.downloadPath,
		TEMP_DOWNLOAD_PATH: paths.tempPath,
		DOWNLOAD_INACTIVITY_TIMEOUT: '300'
	}
}));

const root = paths.root;
const dbPath = paths.dbPath;

const SCHEMA = `
CREATE TABLE downloads (
	id text PRIMARY KEY NOT NULL,
	video_url text NOT NULL,
	original_url text,
	source text NOT NULL DEFAULT 'manual',
	subscription_id text,
	profile_id text,
	folder text,
	file_name text,
	append_title integer NOT NULL,
	quality text NOT NULL,
	status text NOT NULL,
	error_message text,
	title text,
	extractor text,
	extractor_video_id text,
	thumbnail_url text,
	duration integer,
	file_path text,
	metadata_json text,
	advanced_options_json text,
	created_at integer NOT NULL,
	updated_at integer NOT NULL,
	finished_at integer,
	canonical_url text,
	media_key text
);
CREATE UNIQUE INDEX uq_downloads_video_url ON downloads (video_url);
CREATE UNIQUE INDEX uq_downloads_canonical_url ON downloads (canonical_url);
CREATE UNIQUE INDEX uq_downloads_media_key ON downloads (media_key);
`;

type DbApi = {
	addDownloads: typeof import('./db').addDownloads;
	backfillDuplicateKeys: typeof import('./db').backfillDuplicateKeys;
	db: typeof import('./db/index').db;
};

let api: DbApi;

function item(videoUrl: string, extra: Partial<DownloadAdd> = {}): DownloadAdd {
	return {
		videoUrl,
		appendTitle: false,
		quality: 'best',
		status: 'pending',
		...extra
	};
}

beforeAll(async () => {
	mkdirSync(root, { recursive: true });
	const setup = new Database(dbPath);
	setup.exec(SCHEMA);
	setup.close();

	const dbMod = await import('./db');
	const index = await import('./db/index');
	api = {
		addDownloads: dbMod.addDownloads,
		backfillDuplicateKeys: dbMod.backfillDuplicateKeys,
		db: index.db
	};
});

beforeEach(() => {
	api.db.delete(downloadsSchema).run();
});

describe('addDownloads duplicate guard', () => {
	it('rejects an exact second URL and reports the existing row', async () => {
		const url = 'https://example.com/video.mp4';
		const first = await api.addDownloads([item(url, { title: 'Clip' })]);
		const second = await api.addDownloads([item(url)]);

		expect(first.queued).toHaveLength(1);
		expect(second.queued).toHaveLength(0);
		expect(second.duplicates).toHaveLength(1);
		expect(second.duplicates[0].id).toBe(first.queued[0].id);
		expect(second.duplicates[0].message).toContain('Already in the list');
		expect(second.duplicates[0].message).toContain(`/video/${first.queued[0].id}`);
		expect(api.db.select().from(downloadsSchema).all()).toHaveLength(1);
	});

	it('treats YouTube URL spellings as one video', async () => {
		const first = await api.addDownloads([
			item('https://youtu.be/dQw4w9WgXcQ?si=tracking', { title: 'Same title' })
		]);
		const second = await api.addDownloads([
			item('https://m.youtube.com/shorts/dQw4w9WgXcQ?t=12&list=PLxyz')
		]);

		expect(first.queued).toHaveLength(1);
		expect(second.duplicates).toHaveLength(1);
		expect(second.duplicates[0].label).toBe('Same title');
		expect(api.db.select().from(downloadsSchema).all()).toHaveLength(1);
	});

	it('keeps different videos and differently signed files', async () => {
		const outcome = await api.addDownloads([
			item('https://youtu.be/abcdefghijk'),
			item('https://www.youtube.com/watch?v=ZYXWVUTSRQP'),
			item('https://cdn.example.com/a.mp4?sig=one&i=185'),
			item('https://cdn.example.com/b.mp4?sig=two&i=185')
		]);

		expect(outcome.queued).toHaveLength(4);
		expect(outcome.duplicates).toHaveLength(0);
	});

	it('collapses a double submit in one request and across concurrent requests', async () => {
		const url = 'https://example.com/race.mp4?utm_source=twice';
		const batch = await api.addDownloads([item(url), item(`${url}&fbclid=1`)]);
		expect(batch.queued).toHaveLength(1);
		expect(batch.duplicates).toHaveLength(1);

		api.db.delete(downloadsSchema).run();
		const [left, right] = await Promise.all([
			api.addDownloads([item('https://youtu.be/dQw4w9WgXcQ')]),
			api.addDownloads([item('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share')])
		]);

		const queued = left.queued.length + right.queued.length;
		const duplicates = left.duplicates.length + right.duplicates.length;
		expect(queued).toBe(1);
		expect(duplicates).toBe(1);
		expect(api.db.select().from(downloadsSchema).all()).toHaveLength(1);
	});

	it('restarts a failed or cancelled row instead of inserting another', async () => {
		const url = 'https://youtu.be/dQw4w9WgXcQ';
		const created = await api.addDownloads([item(url, { title: 'Same title' })]);
		const id = created.queued[0].id;

		await api.db
			.update(downloadsSchema)
			.set({ status: 'failed', errorMessage: 'boom', finishedAt: new Date() })
			.where(eq(downloadsSchema.id, id));

		const retried = await api.addDownloads([
			item('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=8', { fileName: 'Retry name' })
		]);

		expect(retried.retried).toHaveLength(1);
		expect(retried.retried[0].id).toBe(id);
		expect(retried.retried[0].status).toBe('pending');
		expect(retried.retried[0].errorMessage).toBeNull();
		expect(retried.retried[0].finishedAt).toBeNull();
		expect(retried.retried[0].fileName).toBe('Retry name');
		expect(api.db.select().from(downloadsSchema).all()).toHaveLength(1);

		await api.db
			.update(downloadsSchema)
			.set({ status: 'cancelled', errorMessage: 'Cancelled by user' })
			.where(eq(downloadsSchema.id, id));

		const again = await api.addDownloads([item(url)]);
		expect(again.retried.map((row) => row.id)).toEqual([id]);
		expect(again.retried[0].status).toBe('pending');
	});

	it('blocks a completed or in-progress video', async () => {
		const url = 'https://vimeo.com/123456789';
		const created = await api.addDownloads([item(url, { title: 'Kept' })]);
		const id = created.queued[0].id;

		await api.db
			.update(downloadsSchema)
			.set({ status: 'completed', filePath: '/downloads/kept.mp4', finishedAt: new Date() })
			.where(eq(downloadsSchema.id, id));

		const completed = await api.addDownloads([item('https://player.vimeo.com/video/123456789')]);
		expect(completed.queued).toHaveLength(0);
		expect(completed.retried).toHaveLength(0);
		expect(completed.duplicates[0].message).toContain('Remove that entry');
		expect(completed.duplicates[0].status).toBe('completed');

		const stored = api.db.select().from(downloadsSchema).all();
		expect(stored).toHaveLength(1);
		expect(stored[0].status).toBe('completed');

		await api.db
			.update(downloadsSchema)
			.set({ status: 'downloading', finishedAt: null })
			.where(eq(downloadsSchema.id, id));
		const active = await api.addDownloads([item(url)]);
		expect(active.duplicates[0].status).toBe('downloading');
		expect(api.db.select().from(downloadsSchema).all()).toHaveLength(1);
	});

	it('keeps legacy duplicate rows and gives the dedupe key to one of them', () => {
		const now = new Date();
		api.db
			.insert(downloadsSchema)
			.values([
				{
					id: 'with-file',
					videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
					appendTitle: false,
					quality: 'best',
					status: 'completed',
					title: 'Same title',
					filePath: '/downloads/a.mp4',
					canonicalUrl: null,
					createdAt: now,
					updatedAt: now,
					finishedAt: now
				},
				{
					id: 'extra-copy',
					videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxyz&t=3',
					appendTitle: false,
					quality: 'best',
					status: 'completed',
					title: 'Same title',
					canonicalUrl: null,
					createdAt: now,
					updatedAt: now,
					finishedAt: now
				}
			])
			.run();

		api.backfillDuplicateKeys();

		const rows = api.db.select().from(downloadsSchema).all();
		expect(rows).toHaveLength(2);
		const keyed = rows.filter((row) => row.canonicalUrl);
		expect(keyed.map((row) => row.id)).toEqual(['with-file']);
		expect(rows.find((row) => row.id === 'extra-copy')?.canonicalUrl).toBeNull();
	});
});

describe('dedupe migration', () => {
	it('adds the unique keys without removing existing rows', () => {
		const file = path.join(root, 'legacy.db');
		const database = new Database(file);
		database.exec(
			'CREATE TABLE downloads (id text primary key not null, video_url text not null, status text not null)'
		);
		const insert = database.prepare(
			'INSERT INTO downloads (id, video_url, status) VALUES (?, ?, ?)'
		);
		insert.run('1', 'https://youtu.be/dQw4w9WgXcQ', 'completed');
		insert.run('2', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3', 'completed');

		const sql = readFileSync(path.join(process.cwd(), 'drizzle/0003_download_dedupe.sql'), 'utf8');
		for (const statement of sql.split('--> statement-breakpoint')) database.exec(statement);

		const count = database.prepare('SELECT count(*) AS n FROM downloads').get() as { n: number };
		expect(count.n).toBe(2);

		database
			.prepare('UPDATE downloads SET canonical_url = ? WHERE id = ?')
			.run('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '1');
		expect(() =>
			database
				.prepare('UPDATE downloads SET canonical_url = ? WHERE id = ?')
				.run('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '2')
		).toThrow(/UNIQUE constraint failed/);

		database.close();
	});
});
