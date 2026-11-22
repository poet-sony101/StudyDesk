// All of StudyDesk's data lives in this browser's localStorage; there is no server.
// `request(method, path, body)` keeps the same routes, rules and errors the old
// server API had, so the UI and tests barely changed.
import { computeGpa, classify, planTarget, SCALES } from './gpa.js';
import { validateCourse, validateTask, UUID } from './validate.js';

export const STORAGE_KEY = 'studydesk:v1';
export const EXPORT_FORMAT = 'studydesk-backup';

export class ApiError extends Error {
  constructor(status, errors) {
    super(errors.join(', '));
    this.status = status;
    this.errors = errors;
  }
}

const empty = () => ({ courses: [], tasks: [], settings: { scale: 5 } });

function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // Fallback for pages not served over HTTPS (randomUUID needs a secure context).
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** localStorage if usable; otherwise memory only (e.g. some private browsing modes). */
export function browserStorage() {
  try {
    const probe = '__studydesk_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return { storage: localStorage, persistent: true };
  } catch {
    return { storage: memoryStorage(), persistent: false };
  }
}

export function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/**
 * Cleans up data from storage or an imported file: runs every course and task through
 * the same validation as new entries, drops anything invalid, and unlinks tasks from
 * courses that don't exist. Accepts a StudyDesk backup or the old server's data/db.json.
 */
export function normalize(raw) {
  const source = raw?.format === EXPORT_FORMAT ? raw.data : raw;
  if (!source || typeof source !== 'object' || !Array.isArray(source.courses) || !Array.isArray(source.tasks)) {
    throw new ApiError(400, ["this file isn't a StudyDesk backup"]);
  }
  let skipped = 0;
  const keep = (item, validate) => {
    const { value, errors } = validate(item ?? {});
    if (errors.length) { skipped++; return null; }
    const id = typeof item.id === 'string' && UUID.test(item.id) ? item.id : newId();
    const createdAt = typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString();
    return { id, createdAt, ...value };
  };

  const courses = source.courses.map((c) => keep(c, validateCourse)).filter(Boolean);
  const courseIds = new Set(courses.map((c) => c.id));
  const tasks = source.tasks.map((t) => keep(t, validateTask)).filter(Boolean)
    .map((t) => (t.courseId && !courseIds.has(t.courseId) ? { ...t, courseId: null } : t));
  const scale = SCALES[source.settings?.scale] ? Number(source.settings.scale) : 5;

  return { data: { courses, tasks, settings: { scale } }, skipped };
}

export function createLocalApi(storage = browserStorage().storage) {
  let data = empty();
  try {
    const saved = storage.getItem(STORAGE_KEY);
    if (saved) data = normalize(JSON.parse(saved)).data;
  } catch {
    data = empty(); // unreadable saved data: start fresh rather than break the page
  }

  function save() {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      throw new ApiError(507, ["couldn't save: this browser's storage is full or blocked"]);
    }
  }

  const copy = (x) => JSON.parse(JSON.stringify(x));
  const fail = (status, ...errors) => { throw new ApiError(status, errors); };

  function crud(name, validate, check = () => []) {
    return {
      list: () => data[name],
      create(body) {
        const { value, errors } = validate(body);
        if (!errors.length) errors.push(...check(value));
        if (errors.length) fail(400, ...errors);
        const item = { id: newId(), createdAt: new Date().toISOString(), ...value };
        data[name].push(item);
        save();
        return item;
      },
      update(id, body) {
        const { value, errors } = validate(body, { partial: true });
        if (!errors.length) errors.push(...check(value));
        if (errors.length) fail(400, ...errors);
        const item = data[name].find((i) => i.id === id) ?? fail(404, 'not found');
        Object.assign(item, value);
        save();
        return item;
      },
      remove(id) {
        const before = data[name].length;
        data[name] = data[name].filter((i) => i.id !== id);
        if (data[name].length === before) fail(404, 'not found');
        if (name === 'courses') {
          for (const t of data.tasks) if (t.courseId === id) t.courseId = null; // unlink, don't delete
        }
        save();
        return null;
      },
    };
  }

  const collections = {
    courses: crud('courses', validateCourse),
    tasks: crud('tasks', validateTask, (value) =>
      value.courseId && !data.courses.some((c) => c.id === value.courseId) ? ['course not found'] : []),
  };

  function summary() {
    const { scale } = data.settings;
    const overall = computeGpa(data.courses, scale);
    const bySemester = {};
    for (const c of data.courses) (bySemester[c.semester] ??= []).push(c);
    const semesters = Object.entries(bySemester).map(([name, list]) => ({ name, ...computeGpa(list, scale) }));
    return { ...overall, degreeClass: classify(overall.gpa, scale), semesters };
  }

  function target(params) {
    const { scale } = data.settings;
    const cgpa = Number(params.get('cgpa'));
    const units = params.get('units') ? Number(params.get('units'))
      : data.courses.filter((c) => !c.grade).reduce((sum, c) => sum + c.units, 0);
    const errors = [];
    if (!(cgpa > 0 && cgpa <= scale)) errors.push(`cgpa must be above 0 and at most ${scale}`);
    if (!Number.isInteger(units) || units < 1 || units > 1000) errors.push('remaining units must be a whole number from 1 to 1000');
    if (errors.length) fail(400, ...errors);
    return planTarget(data.courses, { target: cgpa, remainingUnits: units, scale });
  }

  function handle(method, path, body) {
    const url = new URL(path, 'http://local');
    const [, name, id] = url.pathname.split('/');

    if (collections[name]) {
      const col = collections[name];
      if (!id && method === 'GET') return col.list();
      if (!id && method === 'POST') return col.create(body);
      if (id && method === 'PATCH') return col.update(id, body);
      if (id && method === 'DELETE') return col.remove(id);
    }
    if (name === 'settings' && method === 'GET') return data.settings;
    if (name === 'settings' && method === 'PATCH') {
      const scale = Number(body?.scale);
      if (!SCALES[scale]) fail(400, 'scale must be 4 or 5');
      data.settings.scale = scale;
      save();
      return data.settings;
    }
    if (name === 'summary' && method === 'GET') return summary();
    if (name === 'target' && method === 'GET') return target(url.searchParams);
    return fail(404, 'not found');
  }

  return {
    /** Same shape as the old HTTP API; returns copies so callers can't change stored data by accident. */
    request(method, path, body) {
      return copy(handle(method, path, body) ?? null);
    },

    /** A backup the student can download and later import, on this or another device. */
    exportData() {
      return { format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), data: copy(data) };
    },

    /** Replaces all data with an imported backup. Returns counts for a confirmation message. */
    importData(raw) {
      const { data: next, skipped } = normalize(raw);
      const previous = data;
      data = next;
      try {
        save();
      } catch (err) {
        data = previous;
        throw err;
      }
      return { courses: next.courses.length, tasks: next.tasks.length, skipped };
    },
  };
}
