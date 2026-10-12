import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';

const ROOT = join(import.meta.dirname, '../..');
const MIGRATIONS_DIR = join(ROOT, 'migrations');

/**
 * Start a non-persistent local D1 (real SQLite inside workerd, via wrangler.toml's
 * DB binding) with all migrations applied.
 */
export async function createTestDb(): Promise<{ db: D1Database; dispose: () => Promise<void> }> {
  const proxy = await getPlatformProxy<Env>({ configPath: join(ROOT, 'wrangler.toml'), persist: false });
  const db = proxy.env.DB;

  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join('\n');
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }
  return { db, dispose: () => proxy.dispose() };
}
