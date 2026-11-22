import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createStore } from '../src/store.js';

let server;
let base;

before(async () => {
  server = createApp(createStore(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

async function call(path, method = 'GET', body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

test('course lifecycle and GPA summary', async () => {
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
});

test('rejects invalid courses', async () => {
  const r = await call('/courses', 'POST', { code: '', units: 99, grade: 'Z' });
  assert.equal(r.status, 400);
  assert.equal(r.body.errors.length, 3);
});

test('task lifecycle and unlinking on course delete', async () => {
  const course = (await call('/courses', 'POST', { code: 'PHY 101', units: 3 })).body;
  const task = await call('/tasks', 'POST', { title: 'Lab report', dueDate: '2026-12-01', courseId: course.id });
  assert.equal(task.status, 201);
  assert.equal(task.body.done, false);

  const done = await call(`/tasks/${task.body.id}`, 'PATCH', { done: true });
  assert.equal(done.body.done, true);
  assert.equal(done.body.title, 'Lab report', 'partial update keeps other fields');

  await call(`/courses/${course.id}`, 'DELETE');
  const tasks = (await call('/tasks')).body;
  assert.equal(tasks.find((t) => t.id === task.body.id).courseId, null);
});

test('rejects bad task dates and bad JSON', async () => {
  assert.equal((await call('/tasks', 'POST', { title: 'x', dueDate: 'tomorrow' })).status, 400);
  assert.equal((await call('/tasks', 'POST', '{not json')).status, 400);
});

test('switching scale recomputes GPA', async () => {
  assert.equal((await call('/settings', 'PATCH', { scale: 7 })).status, 400);
  await call('/settings', 'PATCH', { scale: 4 });
  const s = (await call('/summary')).body;
  assert.equal(s.scale, 4);
  assert.ok(s.gpa <= 4);
});
