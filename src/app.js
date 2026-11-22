import express from 'express';
import { fileURLToPath } from 'node:url';
import { computeGpa, classify, planTarget, SCALES } from './gpa.js';
import { validateCourse, validateTask } from './validate.js';

const publicDir = fileURLToPath(new URL('../public', import.meta.url));

export function createApp(store) {
  const app = express();
  app.use(express.json());
  app.use(express.static(publicDir));

  const api = express.Router();

  // Generic CRUD routes for a store collection.
  function crud(path, collection, validate, onDelete = () => {}) {
    api.get(path, (req, res) => res.json(collection.list()));

    api.post(path, (req, res) => {
      const { value, errors } = validate(req.body);
      if (errors.length) return res.status(400).json({ errors });
      res.status(201).json(collection.create(value));
    });

    api.patch(`${path}/:id`, (req, res) => {
      const { value, errors } = validate(req.body, { partial: true });
      if (errors.length) return res.status(400).json({ errors });
      const item = collection.update(req.params.id, value);
      if (!item) return res.status(404).json({ errors: ['not found'] });
      res.json(item);
    });

    api.delete(`${path}/:id`, (req, res) => {
      if (!collection.remove(req.params.id)) return res.status(404).json({ errors: ['not found'] });
      onDelete(req.params.id);
      res.status(204).end();
    });
  }

  // Deleting a course unlinks its tasks rather than deleting them.
  crud('/courses', store.courses, validateCourse, (courseId) => {
    for (const t of store.tasks.list()) if (t.courseId === courseId) store.tasks.update(t.id, { courseId: null });
  });
  crud('/tasks', store.tasks, validateTask);

  api.get('/settings', (req, res) => res.json(store.getSettings()));
  api.patch('/settings', (req, res) => {
    const scale = Number(req.body?.scale);
    if (!SCALES[scale]) return res.status(400).json({ errors: ['scale must be 4 or 5'] });
    res.json(store.updateSettings({ scale }));
  });

  // GPA overall (CGPA) and per semester.
  api.get('/summary', (req, res) => {
    const { scale } = store.getSettings();
    const courses = store.courses.list();
    const overall = computeGpa(courses, scale);

    const bySemester = {};
    for (const c of courses) (bySemester[c.semester] ??= []).push(c);
    const semesters = Object.entries(bySemester).map(([name, list]) => ({ name, ...computeGpa(list, scale) }));

    res.json({ ...overall, degreeClass: classify(overall.gpa, scale), semesters });
  });

  // Target CGPA planner. `units` defaults to the units of courses not graded yet.
  api.get('/target', (req, res) => {
    const { scale } = store.getSettings();
    const courses = store.courses.list();
    const target = Number(req.query.cgpa);
    const units = req.query.units ? Number(req.query.units)
      : courses.filter((c) => !c.grade).reduce((sum, c) => sum + c.units, 0);

    const errors = [];
    if (!(target > 0 && target <= scale)) errors.push(`cgpa must be above 0 and at most ${scale}`);
    if (!Number.isInteger(units) || units < 1 || units > 1000) errors.push('remaining units must be a whole number from 1 to 1000');
    if (errors.length) return res.status(400).json({ errors });

    res.json(planTarget(courses, { target, remainingUnits: units, scale }));
  });

  app.use('/api', api);

  // Bad JSON bodies and unexpected errors come back as JSON, not HTML.
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ errors: ['invalid JSON body'] });
    console.error(err);
    res.status(500).json({ errors: ['internal server error'] });
  });

  return app;
}
