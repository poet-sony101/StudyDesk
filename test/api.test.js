import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/createApp.js';
import { connectEmbedded, connectPostgres } from '../src/db.js';

let server;
let db;
let base;

before(async () => {
  // In-memory Postgres by default; set TEST_DATABASE_URL to run against a real (throwaway!) database.
  if (process.env.TEST_DATABASE_URL) {
    db = await connectPostgres(process.env.TEST_DATABASE_URL);
    await db.query('TRUNCATE users, sessions, courses, tasks');
  } else {
    db = await connectEmbedded();
  }
  server = createApp({ getDb: async () => db }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}/api`;
});
after(async () => {
  server.close();
  await db.close();
});

// A tiny client that keeps its own session cookie, like one browser.
function client() {
  let cookie = '';
  return async function call(path, method = 'GET', body) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: res.status === 204 ? null : await res.json(), setCookie: set };
  };
}

async function signedUp(email) {
  const call = client();
  const r = await call('/auth/signup', 'POST', { email, password: 'correct horse battery' });
  assert.equal(r.status, 201);
  return call;
}

// ---- Accounts ----

test('signup, me, logout, login', async () => {
  const call = client();
  assert.equal((await call('/auth/me')).status, 401);

  const signup = await call('/auth/signup', 'POST', { email: ' Ada@Example.com ', password: 'correct horse battery' });
  assert.equal(signup.status, 201);
  assert.equal(signup.body.user.email, 'ada@example.com');
  assert.match(signup.setCookie, /HttpOnly/);
  assert.match(signup.setCookie, /SameSite=Lax/);
  assert.equal((await call('/auth/me')).body.user.email, 'ada@example.com');

  assert.equal((await call('/auth/logout', 'POST')).status, 204);
  assert.equal((await call('/auth/me')).status, 401);

  assert.equal((await call('/auth/login', 'POST', { email: 'ada@example.com', password: 'wrong password' })).status, 401);
  assert.equal((await call('/auth/login', 'POST', { email: 'ADA@example.com', password: 'correct horse battery' })).status, 200);
  assert.equal((await call('/auth/me')).status, 200);
});

test('signup validation and duplicate emails', async () => {
  const call = client();
  const bad = await call('/auth/signup', 'POST', { email: 'not-an-email', password: 'short' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.errors.length, 2);

  await signedUp('dup@example.com');
  const dup = await call('/auth/signup', 'POST', { email: 'DUP@example.com', password: 'another password' });
  assert.equal(dup.status, 409);
});

test('unknown email and wrong password give the same error', async () => {
  await signedUp('known@example.com');
  const call = client();
  const unknown = await call('/auth/login', 'POST', { email: 'nobody@example.com', password: 'whatever123' });
  const wrong = await call('/auth/login', 'POST', { email: 'known@example.com', password: 'whatever123' });
  assert.equal(unknown.status, 401);
  assert.deepEqual(unknown.body, wrong.body);
});

test('data routes require login', async () => {
  const call = client();
  for (const path of ['/courses', '/tasks', '/summary', '/settings', '/target?cgpa=4']) {
    assert.equal((await call(path)).status, 401, path);
  }
  assert.equal((await call('/courses', 'POST', { code: 'X', units: 3 })).status, 401);
});

test("students can't see or change each other's data", async () => {
  const ada = await signedUp('ada2@example.com');
  const bob = await signedUp('bob@example.com');

  const course = (await ada('/courses', 'POST', { code: 'CSC 201', units: 3, grade: 'A' })).body;
  assert.equal((await bob('/courses')).body.length, 0);
  assert.equal((await bob('/summary')).body.gpa, 0);

  assert.equal((await bob(`/courses/${course.id}`, 'PATCH', { grade: 'F' })).status, 404);
  assert.equal((await bob(`/courses/${course.id}`, 'DELETE')).status, 404);
  // Bob can't link his task to Ada's course either.
  assert.equal((await bob('/tasks', 'POST', { title: 'sneaky', courseId: course.id })).status, 400);

  assert.equal((await ada('/courses')).body[0].grade, 'A');
});

// ---- Courses, tasks, GPA ----

test('course lifecycle and GPA summary', async () => {
  const call = await signedUp('courses@example.com');
  const a = await call('/courses', 'POST', { code: 'csc 201', title: 'Programming', units: 3, grade: 'a', semester: '200L First' });
  assert.equal(a.status, 201);
  assert.equal(a.body.code, 'CSC 201');
  assert.equal(a.body.grade, 'A');

  const b = await call('/courses', 'POST', { code: 'MTH 201', units: 2, grade: 'C', semester: '200L First' });
  await call('/courses', 'POST', { code: 'GST 201', units: 2, semester: '200L Second' });

  let summary = (await call('/summary')).body;
  assert.equal(summary.gpa, 4.2);
  assert.equal(summary.degreeClass, 'Second Class Upper');
  assert.equal(summary.semesters.length, 2);

  await call(`/courses/${b.body.id}`, 'PATCH', { grade: 'A' });
  summary = (await call('/summary')).body;
  assert.equal(summary.gpa, 5);

  assert.equal((await call(`/courses/${b.body.id}`, 'DELETE')).status, 204);
  assert.equal((await call(`/courses/${b.body.id}`, 'DELETE')).status, 404);
  assert.equal((await call('/courses/not-a-uuid', 'DELETE')).status, 404);
});

test('rejects invalid courses', async () => {
  const call = await signedUp('invalid@example.com');
  const r = await call('/courses', 'POST', { code: '', units: 99, grade: 'Z' });
  assert.equal(r.status, 400);
  assert.equal(r.body.errors.length, 3);
});

test('task lifecycle and unlinking on course delete', async () => {
  const call = await signedUp('tasks@example.com');
  const course = (await call('/courses', 'POST', { code: 'PHY 101', units: 3 })).body;
  const task = await call('/tasks', 'POST', { title: 'Lab report', dueDate: '2026-12-01', courseId: course.id });
  assert.equal(task.status, 201);
  assert.equal(task.body.done, false);
  assert.equal(task.body.courseId, course.id);

  const done = await call(`/tasks/${task.body.id}`, 'PATCH', { done: true });
  assert.equal(done.body.done, true);
  assert.equal(done.body.title, 'Lab report', 'partial update keeps other fields');

  await call(`/courses/${course.id}`, 'DELETE');
  const tasks = (await call('/tasks')).body;
  assert.equal(tasks.find((t) => t.id === task.body.id).courseId, null);
});

test('rejects bad task dates, course ids and JSON', async () => {
  const call = await signedUp('badtasks@example.com');
  assert.equal((await call('/tasks', 'POST', { title: 'x', dueDate: 'tomorrow' })).status, 400);
  assert.equal((await call('/tasks', 'POST', { title: 'x', courseId: 'nope' })).status, 400);
  assert.equal((await call('/tasks', 'POST', '{not json')).status, 400);
});

test('scale is saved per user and recomputes GPA', async () => {
  const call = await signedUp('scale@example.com');
  const other = await signedUp('scale2@example.com');
  await call('/courses', 'POST', { code: 'CSC 101', units: 3, grade: 'A' });

  assert.equal((await call('/settings', 'PATCH', { scale: 7 })).status, 400);
  await call('/settings', 'PATCH', { scale: 4 });
  assert.equal((await call('/settings')).body.scale, 4);
  assert.equal((await call('/summary')).body.gpa, 4);
  assert.equal((await other('/settings')).body.scale, 5);
});

test('target endpoint defaults to ungraded units and validates input', async () => {
  const call = await signedUp('target@example.com');
  await call('/courses', 'POST', { code: 'CSC 101', units: 10, grade: 'B' });
  await call('/courses', 'POST', { code: 'CSC 102', units: 2 });

  const r = await call('/target?cgpa=4.5');
  assert.equal(r.status, 200);
  assert.equal(r.body.remainingUnits, 2);

  assert.equal((await call('/target?cgpa=4.5&units=15')).body.remainingUnits, 15);
  assert.equal((await call('/target?cgpa=6')).status, 400);
  assert.equal((await call('/target?cgpa=4&units=0')).status, 400);
});
