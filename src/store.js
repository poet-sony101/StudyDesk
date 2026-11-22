// Data access. Every course/task query is scoped to the signed-in user's id,
// so one student can never read or change another student's data.
import { createHash, randomBytes } from 'node:crypto';

const COURSE_COLS = `id, code, title, units, grade, semester, created_at AS "createdAt"`;
const TASK_COLS = `id, title, due_date AS "dueDate", course_id AS "courseId", done, created_at AS "createdAt"`;
const SESSION_DAYS = 30;

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

// Builds "col1 = $2, col2 = $3" from camelCase fields, allowing only known columns.
function setClause(fields, columns, offset) {
  const keys = Object.keys(fields).filter((k) => k in columns);
  return {
    sql: keys.map((k, i) => `${columns[k]} = $${i + offset}`).join(', '),
    values: keys.map((k) => fields[k]),
  };
}

function collection(db, table, cols, columns) {
  return {
    async list(userId) {
      const { rows } = await db.query(`SELECT ${cols} FROM ${table} WHERE user_id = $1 ORDER BY created_at`, [userId]);
      return rows;
    },
    async create(userId, fields) {
      const keys = Object.keys(fields).filter((k) => k in columns);
      const { rows } = await db.query(
        `INSERT INTO ${table} (user_id, ${keys.map((k) => columns[k]).join(', ')})
         VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING ${cols}`,
        [userId, ...keys.map((k) => fields[k])]);
      return rows[0];
    },
    async update(userId, id, fields) {
      const set = setClause(fields, columns, 3);
      const sql = set.sql
        ? `UPDATE ${table} SET ${set.sql} WHERE id = $1 AND user_id = $2 RETURNING ${cols}`
        : `SELECT ${cols} FROM ${table} WHERE id = $1 AND user_id = $2`;
      const { rows } = await db.query(sql, [id, userId, ...set.values]);
      return rows[0] ?? null;
    },
    async remove(userId, id) {
      const { rows } = await db.query(`DELETE FROM ${table} WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
      return rows.length > 0;
    },
  };
}

export function createStore(db) {
  return {
    courses: collection(db, 'courses', COURSE_COLS,
      { code: 'code', title: 'title', units: 'units', grade: 'grade', semester: 'semester' }),
    tasks: collection(db, 'tasks', TASK_COLS,
      { title: 'title', dueDate: 'due_date', courseId: 'course_id', done: 'done' }),

    async courseBelongsTo(userId, courseId) {
      const { rows } = await db.query('SELECT 1 FROM courses WHERE id = $1 AND user_id = $2', [courseId, userId]);
      return rows.length > 0;
    },

    // Users
    async createUser(email, passwordHash) {
      const { rows } = await db.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, scale', [email, passwordHash]);
      return rows[0];
    },
    async findUserByEmail(email) {
      const { rows } = await db.query('SELECT id, email, scale, password_hash AS "passwordHash" FROM users WHERE email = $1', [email]);
      return rows[0] ?? null;
    },
    async setScale(userId, scale) {
      await db.query('UPDATE users SET scale = $2 WHERE id = $1', [userId, scale]);
    },

    // Sessions: the browser keeps a random token; only its SHA-256 hash is stored.
    async createSession(userId) {
      const token = randomBytes(32).toString('base64url');
      await db.query(
        `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`,
        [hashToken(token), userId]);
      await db.query('DELETE FROM sessions WHERE expires_at < now()');
      return { token, maxAgeSeconds: SESSION_DAYS * 86400 };
    },
    async userForSession(token) {
      const { rows } = await db.query(
        `SELECT u.id, u.email, u.scale FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = $1 AND s.expires_at > now()`, [hashToken(token)]);
      return rows[0] ?? null;
    },
    async deleteSession(token) {
      await db.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
    },
  };
}
