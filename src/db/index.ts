import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const sqlite = new Database(process.env.DATABASE_URL || './sign-configurator.db');

// Enable WAL mode for better performance
sqlite.pragma('journal_mode = WAL');

const db = drizzle(sqlite, { schema });

export default db;
