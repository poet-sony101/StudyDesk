import express from 'express';
import { fileURLToPath } from 'node:url';
import { computeGpa, classify, planTarget, SCALES } from './gpa.js';
import { validateCourse, validateTask, UUID } from './validate.js';
import { createStore } from './store.js';
import {
  hashPassword, verifyPassword, DUMMY_HASH, COOKIE, readCookie, sessionCookie, validateCredentials,
} from './auth.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

// Express 4 doesn't catch errors from async handlers; pass them to the error handler.
const route = (fn) => (req, res, next) => fn(req, res, next).catch(next);

/** `getDb` returns a promise of a connection with `query(sql, params)`. */
export function createApp({ getDb }) {
  const app = express();
  app.set('trust proxy', 1); // behind Vercel's proxy: lets req.secure see HTTPS
  app.use(express.json());
  app.use(express.static(publicDir));

  const api = express.Router();
  api.use(route(async (req, res, next) => {
    req.store = createStore(await getDb());
    next();
  }));

  // ---- Accounts (no login needed) ----

  async function startSession(req, res, user) {
    const { token, maxAgeSeconds } = await req.store.createSession(user.id);
    res.setHeader('Set-Cookie', sessionCookie(req, token, maxAgeSeconds));
    res.json({ user: { email: user.email } });
  }

  api.post('/auth/signup', route(async (req, res) => {
    const { email, password, errors } = validateCredentials(req.body);
    if (errors.length) return res.status(400).json({ errors });
    try {
      const user = await req.store.createUser(email, await hashPassword(password));
      res.status(201);
      await startSession(req, res, user);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ errors: ['an account with this email already exists'] });
      throw err;
    }
  }));

  api.post('/auth/login', route(async (req, res) => {
    const { email, password } = validateCredentials(req.body);
    const user = email && await req.store.findUserByEmail(email);
    const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
    if (!user || !ok) return res.status(401).json({ errors: ['incorrect email or password'] });
    await startSession(req, res, user);
  }));

  api.post('/auth/logout', route(async (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) await req.store.deleteSession(token);
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    res.status(204).end();
  }));

  // ---- Everything below requires a logged-in user ----

  api.use(route(async (req, res, next) => {
    const token = readCookie(req, COOKIE);
    req.user = token ? await req.store.userForSession(token) : null;
    if (!req.user) return res.status(401).json({ errors: ['please log in'] });
    next();
  }));

  api.get('/auth/me', (req, res) => res.json({ user: { email: req.user.email } }));

  // Generic CRUD routes for a per-user collection.
  function crud(path, name, validate, check = async () => []) {
    const col = (req) => req.store[name];

    api.get(path, route(async (req, res) => res.json(await col(req).list(req.user.id))));

    api.post(path, route(async (req, res) => {
      const { value, errors } = validate(req.body);
      if (!errors.length) errors.push(...await check(req, value));
      if (errors.length) return res.status(400).json({ errors });
      res.status(201).json(await col(req).create(req.user.id, value));
    }));

    api.patch(`${path}/:id`, route(async (req, res) => {
      if (!UUID.test(req.params.id)) return res.status(404).json({ errors: ['not found'] });
      const { value, errors } = validate(req.body, { partial: true });
      if (!errors.length) errors.push(...await check(req, value));
      if (errors.length) return res.status(400).json({ errors });
      const item = await col(req).update(req.user.id, req.params.id, value);
      if (!item) return res.status(404).json({ errors: ['not found'] });
      res.json(item);
    }));

    api.delete(`${path}/:id`, route(async (req, res) => {
      if (!UUID.test(req.params.id) || !await col(req).remove(req.user.id, req.params.id)) {
        return res.status(404).json({ errors: ['not found'] });
      }
      res.status(204).end();
    }));
  }

  // Deleting a course unlinks its tasks (ON DELETE SET NULL in the schema).
  crud('/courses', 'courses', validateCourse);
  // A task can only be linked to one of the user's own courses.
  crud('/tasks', 'tasks', validateTask, async (req, value) =>
    value.courseId && !await req.store.courseBelongsTo(req.user.id, value.courseId) ? ['course not found'] : []);

  api.get('/settings', (req, res) => res.json({ scale: req.user.scale }));
  api.patch('/settings', route(async (req, res) => {
    const scale = Number(req.body?.scale);
    if (!SCALES[scale]) return res.status(400).json({ errors: ['scale must be 4 or 5'] });
    await req.store.setScale(req.user.id, scale);
    res.json({ scale });
  }));

  // GPA overall (CGPA) and per semester.
  api.get('/summary', route(async (req, res) => {
    const { scale } = req.user;
    const courses = await req.store.courses.list(req.user.id);
    const overall = computeGpa(courses, scale);

    const bySemester = {};
    for (const c of courses) (bySemester[c.semester] ??= []).push(c);
    const semesters = Object.entries(bySemester).map(([name, list]) => ({ name, ...computeGpa(list, scale) }));

    res.json({ ...overall, degreeClass: classify(overall.gpa, scale), semesters });
  }));

  // Target CGPA planner. `units` defaults to the units of courses not graded yet.
  api.get('/target', route(async (req, res) => {
    const { scale } = req.user;
    const courses = await req.store.courses.list(req.user.id);
    const target = Number(req.query.cgpa);
    const units = req.query.units ? Number(req.query.units)
      : courses.filter((c) => !c.grade).reduce((sum, c) => sum + c.units, 0);

    const errors = [];
    if (!(target > 0 && target <= scale)) errors.push(`cgpa must be above 0 and at most ${scale}`);
    if (!Number.isInteger(units) || units < 1 || units > 1000) errors.push('remaining units must be a whole number from 1 to 1000');
    if (errors.length) return res.status(400).json({ errors });

    res.json(planTarget(courses, { target, remainingUnits: units, scale }));
  }));

  app.use('/api', api);

  // Bad JSON bodies and unexpected errors come back as JSON, not HTML.
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ errors: ['invalid JSON body'] });
    console.error(err);
    res.status(500).json({ errors: [err.expose ? err.message : 'internal server error'] });
  });

  return app;
}
