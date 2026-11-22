import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalApi, memoryStorage, STORAGE_KEY } from '../public/localApi.js';

// Each test gets a fresh "browser": its own storage and API.
function fresh() {
  const storage = memoryStorage();
  const api = createLocalApi(storage);
  const call = (path, method = 'GET', body) => api.request(method, path, body);
  return { storage, api, call };
}

const rejects = (fn, status, pattern) => assert.throws(fn, (err) => err.status === status && (!pattern || pattern.test(err.message)));

test('course lifecycle and GPA summary', () => {
  const { call } = fresh();
  const a = call('/courses', 'POST', { code: 'csc 201', title: 'Programming', units: 3, grade: 'a', semester: '200L First' });
  assert.equal(a.code, 'CSC 201');
  assert.equal(a.grade, 'A');

  const b = call('/courses', 'POST', { code: 'MTH 201', units: '2', grade: 'C', semester: '200L First' });
  call('/courses', 'POST', { code: 'GST 201', units: 2, semester: '200L Second' });

  let summary = call('/summary');
  assert.equal(summary.gpa, 4.2);
  assert.equal(summary.degreeClass, 'Second Class Upper');
  assert.equal(summary.semesters.length, 2);

  call(`/courses/${b.id}`, 'PATCH', { grade: 'A' });
  assert.equal(call('/summary').gpa, 5);

  call(`/courses/${b.id}`, 'DELETE');
  rejects(() => call(`/courses/${b.id}`, 'DELETE'), 404);
});

test('rejects invalid courses', () => {
  const { call } = fresh();
  assert.throws(() => call('/courses', 'POST', { code: '', units: 99, grade: 'Z' }), (err) => err.status === 400 && err.errors.length === 3);
});

test('partial edits keep other fields and still validate', () => {
  const { call } = fresh();
  const c = call('/courses', 'POST', { code: 'CSC 201', title: 'Programming', units: 3 });
  const edited = call(`/courses/${c.id}`, 'PATCH', { units: 4 });
  assert.equal(edited.units, 4);
  assert.equal(edited.title, 'Programming');
  rejects(() => call(`/courses/${c.id}`, 'PATCH', { code: '' }), 400, /code is required/);
  rejects(() => call('/courses/does-not-exist', 'PATCH', { units: 2 }), 404);
});

test('returned objects are copies, not the stored data', () => {
  const { call } = fresh();
  const c = call('/courses', 'POST', { code: 'CSC 201', units: 3 });
  c.units = 99;
  call('/courses')[0].code = 'HACKED';
  assert.equal(call('/courses')[0].units, 3);
  assert.equal(call('/courses')[0].code, 'CSC 201');
});

test('task lifecycle and unlinking on course delete', () => {
  const { call } = fresh();
  const course = call('/courses', 'POST', { code: 'PHY 101', units: 3 });
  const task = call('/tasks', 'POST', { title: 'Lab report', dueDate: '2026-12-01', courseId: course.id });
  assert.equal(task.done, false);

  const done = call(`/tasks/${task.id}`, 'PATCH', { done: true });
  assert.equal(done.done, true);
  assert.equal(done.title, 'Lab report');

  call(`/courses/${course.id}`, 'DELETE');
  assert.equal(call('/tasks')[0].courseId, null);
});

test('rejects bad task dates and unknown course links', () => {
  const { call } = fresh();
  rejects(() => call('/tasks', 'POST', { title: 'x', dueDate: 'tomorrow' }), 400);
  rejects(() => call('/tasks', 'POST', { title: 'x', courseId: 'nope' }), 400);
  rejects(() => call('/tasks', 'POST', { title: 'x', courseId: '1b4e28ba-2fa1-4d2b-883f-0016d3cca427' }), 400, /course not found/);
});

test('scale setting recomputes GPA', () => {
  const { call } = fresh();
  call('/courses', 'POST', { code: 'CSC 101', units: 3, grade: 'A' });
  rejects(() => call('/settings', 'PATCH', { scale: 7 }), 400);
  call('/settings', 'PATCH', { scale: 4 });
  assert.equal(call('/settings').scale, 4);
  assert.equal(call('/summary').gpa, 4);
});

test('target planner defaults to ungraded units and validates input', () => {
  const { call } = fresh();
  call('/courses', 'POST', { code: 'CSC 101', units: 10, grade: 'B' });
  call('/courses', 'POST', { code: 'CSC 102', units: 2 });
  assert.equal(call('/target?cgpa=4.5').remainingUnits, 2);
  assert.equal(call('/target?cgpa=4.5&units=15').remainingUnits, 15);
  rejects(() => call('/target?cgpa=6'), 400);
  rejects(() => call('/target?cgpa=4&units=0'), 400);
});

test('data survives a page reload (new API over the same storage)', () => {
  const { storage, call } = fresh();
  call('/courses', 'POST', { code: 'CSC 201', units: 3, grade: 'A' });
  call('/settings', 'PATCH', { scale: 4 });

  const reloaded = createLocalApi(storage);
  assert.equal(reloaded.request('GET', '/courses')[0].code, 'CSC 201');
  assert.equal(reloaded.request('GET', '/settings').scale, 4);
});

test('corrupted saved data starts fresh instead of breaking the page', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEY, '{not json');
  assert.deepEqual(createLocalApi(storage).request('GET', '/courses'), []);
});

test('a full storage reports a clear error', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
  const api = createLocalApi(storage);
  rejects(() => api.request('POST', '/courses', { code: 'CSC 201', units: 3 }), 507, /storage is full/);
});

test('export then import restores everything on another device', () => {
  const a = fresh();
  const course = a.call('/courses', 'POST', { code: 'CSC 201', units: 3, grade: 'A' });
  a.call('/tasks', 'POST', { title: 'Assignment', courseId: course.id });
  a.call('/settings', 'PATCH', { scale: 4 });
  const backup = JSON.parse(JSON.stringify(a.api.exportData())); // as if saved to a file

  const b = fresh();
  b.call('/courses', 'POST', { code: 'OLD 101', units: 1 });
  assert.deepEqual(b.api.importData(backup), { courses: 1, tasks: 1, skipped: 0 });
  assert.deepEqual(b.call('/courses'), a.call('/courses'));
  assert.equal(b.call('/tasks')[0].courseId, course.id);
  assert.equal(b.call('/settings').scale, 4);
});

test("imports the old server's data/db.json, skipping invalid items", () => {
  const { api, call } = fresh();
  const oldDb = {
    courses: [
      { id: '1b4e28ba-2fa1-4d2b-883f-0016d3cca427', code: 'CSC 201', title: 'Programming', units: 3, grade: 'A', semester: '200L First', createdAt: '2026-11-01T10:00:00.000Z' },
      { id: 'x', code: '', units: 3 }, // invalid: no code
    ],
    tasks: [
      { id: '2c5f39cb-3fb2-4e3c-994f-1127e4ddb538', title: 'Lab', courseId: '1b4e28ba-2fa1-4d2b-883f-0016d3cca427', done: false },
      { title: 'Orphan', courseId: '3d6a4adc-4ac3-4f4d-aa5f-2238f5eec649' }, // course doesn't exist -> unlinked
    ],
    settings: { scale: 5 },
  };
  assert.deepEqual(api.importData(oldDb), { courses: 1, tasks: 2, skipped: 1 });
  assert.equal(call('/courses')[0].id, '1b4e28ba-2fa1-4d2b-883f-0016d3cca427');
  assert.equal(call('/tasks').find((t) => t.title === 'Orphan').courseId, null);
});

test('rejects files that are not backups, keeping existing data', () => {
  const { api, call } = fresh();
  call('/courses', 'POST', { code: 'CSC 201', units: 3 });
  rejects(() => api.importData({ hello: 'world' }), 400, /isn't a StudyDesk backup/);
  rejects(() => api.importData(null), 400);
  assert.equal(call('/courses').length, 1);
});
