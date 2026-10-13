// A tiny stand-in for Cloudflare D1 using Node's built-in SQLite, so the Worker runs locally
// (growth/server.mjs) and in tests without any extra dependency.
import { DatabaseSync } from 'node:sqlite';

export function sqliteD1(file = ':memory:') {
  const db = new DatabaseSync(file);
  return {
    prepare(sql) {
      let args = [];
      const stmt = () => db.prepare(sql);
      const api = {
        bind(...a) { args = a; return api; },
        async run() { const r = stmt().run(...args); return { success: true, meta: { changes: r.changes } }; },
        async all() { return { results: stmt().all(...args).map((r) => ({ ...r })) }; },
        async first() { return stmt().get(...args) ?? null; },
      };
      return api;
    },
    close: () => db.close(),
  };
}
