import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';

const ROOT = join(import.meta.dirname, '../..');
const MIGRATIONS_DIR = join(ROOT, 'migrations');

async function applyMigrations(db: D1Database) {
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
}

/**
 * Start non-persistent local bindings (real SQLite D1 and R2 inside workerd, from wrangler.toml)
 * with all migrations applied.
 */
export async function createTestEnv(): Promise<{ db: D1Database; files: R2Bucket; dispose: () => Promise<void> }> {
  const proxy = await getPlatformProxy<Env>({ configPath: join(ROOT, 'wrangler.toml'), persist: false });
  await applyMigrations(proxy.env.DB);
  return { db: proxy.env.DB, files: proxy.env.FILES, dispose: () => proxy.dispose() };
}

export async function createTestDb(): Promise<{ db: D1Database; dispose: () => Promise<void> }> {
  const { db, dispose } = await createTestEnv();
  return { db, dispose };
}
