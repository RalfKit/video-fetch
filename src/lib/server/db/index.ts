import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import { env } from '$env/dynamic/private';
import fs from 'fs';
import path from 'path';

type Db = BetterSQLite3Database<typeof schema>;

let instance: Db | null = null;

function createDb(): Db {
	if (!env.DATABASE_PATH) throw new Error('DATABASE_PATH is not set');
	fs.mkdirSync(path.dirname(env.DATABASE_PATH), { recursive: true });

	const client = new Database(env.DATABASE_PATH);
	return drizzle(client, { schema });
}

/**
 * Returns the shared Drizzle database instance, creating it on first use.
 *
 * The connection is created lazily so that merely importing this module (for
 * example during the SvelteKit build analysis step, where `DATABASE_PATH` is
 * not set) does not open a database file or throw.
 */
export function getDb(): Db {
	if (!instance) instance = createDb();
	return instance;
}

/**
 * Lazy proxy around the Drizzle instance. Property access initializes the real
 * connection on demand, so existing `db.select()` / `db.insert()` call sites
 * keep working without eager connection at import time.
 */
export const db = new Proxy({} as Db, {
	get(_target, prop, receiver) {
		const real = getDb();
		const value = Reflect.get(real, prop, receiver);
		return typeof value === 'function' ? value.bind(real) : value;
	}
});
