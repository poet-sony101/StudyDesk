// Database connection.
// - With DATABASE_URL (or POSTGRES_URL) set, e.g. on Vercel with Neon: a real Postgres server.
// - Without it, e.g. `npm start` on your computer: an embedded Postgres (PGlite) saved in ./data/pglite.
// Both expose the same `query(sql, params) -> { rows }`.

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    scale         int  NOT NULL DEFAULT 5,
    created_at    timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
  );
  CREATE TABLE IF NOT EXISTS courses (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code       text NOT NULL,
    title      text NOT NULL DEFAULT '',
    units      int  NOT NULL,
    grade      text,
    semester   text NOT NULL DEFAULT 'Unassigned',
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    course_id  uuid REFERENCES courses(id) ON DELETE SET NULL,
    title      text NOT NULL,
    due_date   text,
    done       boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS courses_user_idx ON courses(user_id);
  CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks(user_id);
  CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
`;

async function migrate(db, attempt = 1) {
  try {
    // pg runs multiple statements in one simple query; PGlite needs exec().
    if (db.exec) await db.exec(SCHEMA);
    else await db.query(SCHEMA);
  } catch (err) {
    // On Vercel several cold starts can create the tables at the same moment;
    // the loser gets a duplicate-object error, and a retry then finds everything in place.
    if (attempt < 3 && ['23505', '42P07', '42710'].includes(err.code)) return migrate(db, attempt + 1);
    throw err;
  }
  return db;
}

export async function connectPostgres(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 3 });
  return migrate({ query: (sql, params) => pool.query(sql, params), close: () => pool.end() });
}

/** Embedded Postgres. Pass a folder to persist, or nothing for in-memory (tests). */
export async function connectEmbedded(dataDir) {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(dataDir);
  return migrate({ query: (sql, params) => pg.query(sql, params), exec: (sql) => pg.exec(sql), close: () => pg.close() });
}

let shared;

/** The app-wide connection, opened on first use. */
export function getDb() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url && process.env.VERCEL) {
    // Vercel's disk is read-only, so the local database can't work there.
    return Promise.reject(Object.assign(new Error('No database connected. In Vercel, open the project → Storage → connect a Neon Postgres database, then redeploy.'), { expose: true }));
  }
  shared ??= url ? connectPostgres(url) : connectEmbedded(process.env.PGLITE_DIR || './data/pglite');
  shared.catch(() => { shared = undefined; }); // retry on the next request if connecting failed
  return shared;
}
