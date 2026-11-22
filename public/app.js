const $ = (sel) => document.querySelector(sel);
const state = { courses: [], tasks: [], summary: null, settings: { scale: 5 }, editing: null };
const GRADE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (res.status === 401 && !path.startsWith('/auth/')) showAuth();
  if (!res.ok) throw new Error(data.errors?.join(', ') || 'Request failed');
  return data;
}

// ---- Accounts ----

let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  $('#auth-title').textContent = signup ? 'Create your account' : 'Log in';
  $('#auth-intro').textContent = signup
    ? 'Track your courses, CGPA and deadlines. Your data is private to your account.'
    : 'Welcome back. Log in to see your courses and deadlines.';
  $('#auth-submit').textContent = signup ? 'Create account' : 'Log in';
  $('#auth-switch-text').textContent = signup ? 'Already have an account?' : 'New to StudyDesk?';
  $('#auth-switch').textContent = signup ? 'Log in' : 'Create an account';
  $('#auth-form').password.autocomplete = signup ? 'new-password' : 'current-password';
  $('#auth-error').hidden = true;
}

function showAuth() {
  $('#app').hidden = true;
  $('#account').hidden = true;
  $('#auth').hidden = false;
  $('#auth-form').email.focus();
}

function showApp(user) {
  $('#auth').hidden = true;
  $('#app').hidden = false;
  $('#account').hidden = false;
  $('#user-email').textContent = user.email;
}

$('#auth-switch').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'signup' : 'login'));

$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = $('#auth-submit');
  button.disabled = true;
  try {
    const { user } = await api(`/auth/${authMode}`, {
      method: 'POST', body: { email: form.email.value, password: form.password.value },
    });
    form.reset();
    showApp(user);
    await load();
  } catch (err) {
    const msg = err.message;
    $('#auth-error').textContent = msg.charAt(0).toUpperCase() + msg.slice(1) + '.';
    $('#auth-error').hidden = false;
  } finally {
    button.disabled = false;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  Object.assign(state, { courses: [], tasks: [], summary: null, editing: null });
  $('#target-form').reset();
  $('#target-result').replaceChildren(h('p', { className: 'empty' }, 'Enter the CGPA you\'re aiming for to see the grades you need.'));
  setAuthMode('login');
  showAuth();
});

async function start() {
  try {
    const { user } = await api('/auth/me');
    showApp(user);
    await load();
  } catch (err) {
    showAuth();
    if (err.message !== 'please log in') {
      $('#auth-error').textContent = err.message;
      $('#auth-error').hidden = false;
    }
  }
}

function showError(message) {
  const el = $('#error');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(showError.timer);
  showError.timer = setTimeout(() => (el.hidden = true), 4000);
}

// Builds an element without innerHTML, so user text is never parsed as HTML.
function h(tag, props = {}, ...children) {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children.flat().filter((c) => c != null));
  return el;
}

async function load() {
  const [courses, tasks, summary, settings] = await Promise.all([
    api('/courses'), api('/tasks'), api('/summary'), api('/settings'),
  ]);
  Object.assign(state, { courses, tasks, summary, settings });
  render();
  updateTarget();
}

function render() {
  const { summary, courses, tasks, settings } = state;
  $('#scale').value = settings.scale;
  $('#gpa').textContent = summary.gpa.toFixed(2);
  $('#class').textContent = summary.totalUnits ? summary.degreeClass : '—';
  $('#units').textContent = summary.totalUnits;
  $('#due').textContent = tasks.filter((t) => !t.done).length;

  renderCourses(courses, summary.semesters);
  renderTasks(tasks, courses);

  const semesterNames = [...new Set(courses.map((c) => c.semester))];
  $('#semesters').replaceChildren(...semesterNames.map((s) => h('option', { value: s })));
  $('#task-course').replaceChildren(
    h('option', { value: '' }, 'No course'),
    ...courses.map((c) => h('option', { value: c.id }, c.code)),
  );
  $('#target-form [name=cgpa]').max = settings.scale;

  document.querySelector('form.edit input')?.focus();
}

// Small helpers shared by the edit forms.
function gradeSelect(current, props = {}) {
  return h('select', props,
    h('option', { value: '' }, '—'),
    ...GRADE_LETTERS.map((g) => h('option', { value: g, selected: current === g }, g)));
}

function iconButton(label, text, onClick, className = 'link') {
  const btn = h('button', { className, type: 'button', ariaLabel: label, title: label }, text);
  btn.addEventListener('click', onClick);
  return btn;
}

function startEdit(key) {
  state.editing = key;
  render();
}

function cancelEdit() {
  state.editing = null;
  render();
}

// Wraps fields in a form that saves with Enter / Save and cancels with Escape / Cancel.
function editForm(path, fields) {
  const form = h('form', { className: 'row edit' }, fields,
    h('button', {}, 'Save'),
    iconButton('Cancel editing', 'Cancel', cancelEdit, 'secondary'));
  form.addEventListener('keydown', (e) => e.key === 'Escape' && cancelEdit());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(path, { method: 'PATCH', body: Object.fromEntries(new FormData(form)) });
      state.editing = null;
      await load();
    } catch (err) {
      showError(err.message);
    }
  });
  return form;
}

function courseEditor(c) {
  const semester = h('input', { name: 'semester', value: c.semester, placeholder: 'Semester', ariaLabel: 'Semester' });
  semester.setAttribute('list', 'semesters');
  return editForm(`/courses/${c.id}`, [
    h('input', { name: 'code', value: c.code, required: true, maxLength: 20, placeholder: 'Code', ariaLabel: 'Code' }),
    h('input', { name: 'title', value: c.title, maxLength: 120, placeholder: 'Title', ariaLabel: 'Title' }),
    h('input', { name: 'units', type: 'number', min: 0, max: 12, value: c.units, required: true, ariaLabel: 'Units' }),
    gradeSelect(c.grade, { name: 'grade', ariaLabel: 'Grade' }),
    semester,
  ]);
}

function taskEditor(t, courses) {
  return editForm(`/tasks/${t.id}`, [
    h('input', { name: 'title', value: t.title, required: true, maxLength: 200, ariaLabel: 'Task' }),
    h('input', { name: 'dueDate', type: 'date', value: t.dueDate ?? '', ariaLabel: 'Due date' }),
    h('select', { name: 'courseId', ariaLabel: 'Course' },
      h('option', { value: '' }, 'No course'),
      ...courses.map((c) => h('option', { value: c.id, selected: c.id === t.courseId }, c.code))),
  ]);
}

function renderCourses(courses, semesters) {
  const root = $('#courses');
  if (!courses.length) return root.replaceChildren(h('p', { className: 'empty' }, 'No courses yet. Add your first one above.'));

  root.replaceChildren(...semesters.map((sem) => {
    const rows = courses.filter((c) => c.semester === sem.name).map((c) => {
      if (state.editing === `course:${c.id}`) return h('tr', {}, h('td', { colSpan: 5 }, courseEditor(c)));

      const grade = gradeSelect(c.grade, { ariaLabel: `Grade for ${c.code}` });
      grade.addEventListener('change', () => mutate(`/courses/${c.id}`, 'PATCH', { grade: grade.value || null }));

      return h('tr', {}, h('td', {}, c.code), h('td', {}, c.title), h('td', { className: 'num' }, String(c.units)),
        h('td', {}, grade),
        h('td', { className: 'num actions' },
          iconButton(`Edit ${c.code}`, '✎', () => startEdit(`course:${c.id}`), 'link edit-btn'),
          iconButton(`Delete ${c.code}`, '✕', () => confirm(`Delete ${c.code}?`) && mutate(`/courses/${c.id}`, 'DELETE'))));
    });

    return h('div', {},
      h('div', { className: 'semester' }, sem.name, h('span', {}, `GPA ${sem.gpa.toFixed(2)} · ${sem.totalUnits} units`)),
      h('div', { className: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Title'), h('th', { className: 'num' }, 'Units'), h('th', {}, 'Grade'), h('th', {}))),
        h('tbody', {}, rows))));
  }));
}

function dueLabel(dueDate) {
  if (!dueDate) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(`${dueDate}T00:00:00`) - today) / 86400000);
  const text = days < 0 ? `${-days}d overdue` : days === 0 ? 'due today' : `in ${days}d`;
  return h('span', { className: `due tag ${days < 0 ? 'overdue' : days <= 2 ? 'soon' : ''}` }, `${dueDate} · ${text}`);
}

function renderTasks(tasks, courses) {
  const root = $('#tasks');
  if (!tasks.length) return root.replaceChildren(h('li', { className: 'empty' }, 'Nothing due. Nice.'));

  // Open tasks first, then by due date (undated last).
  const sorted = [...tasks].sort((a, b) =>
    a.done - b.done || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));

  root.replaceChildren(...sorted.map((t) => {
    if (state.editing === `task:${t.id}`) return h('li', {}, taskEditor(t, courses));

    const course = courses.find((c) => c.id === t.courseId);
    const box = h('input', { type: 'checkbox', checked: t.done, ariaLabel: `Mark ${t.title} done` });
    box.addEventListener('change', () => mutate(`/tasks/${t.id}`, 'PATCH', { done: box.checked }));

    return h('li', { className: t.done ? 'done' : '' },
      box, h('span', { className: 'title' }, t.title),
      course ? h('span', { className: 'tag' }, course.code) : null,
      dueLabel(t.dueDate),
      h('span', { className: 'actions' },
        iconButton(`Edit ${t.title}`, '✎', () => startEdit(`task:${t.id}`), 'link edit-btn'),
        iconButton(`Delete ${t.title}`, '✕', () => mutate(`/tasks/${t.id}`, 'DELETE'))));
  }));
}

// Target CGPA planner.
async function updateTarget() {
  const form = $('#target-form');
  const cgpa = form.cgpa.value;
  if (!cgpa) return;
  const params = new URLSearchParams({ cgpa });
  if (form.units.value) params.set('units', form.units.value);

  const out = $('#target-result');
  try {
    const r = await api(`/target?${params}`);
    const lead = `To reach ${Number(r.target).toFixed(2)} from ${r.current.toFixed(2)} over ${r.remainingUnits} more units, `;
    if (r.status === 'secured') {
      out.replaceChildren(h('p', { className: 'result ok' }, `You've already secured ${Number(r.target).toFixed(2)}: you'd stay at or above it even with all F's over ${r.remainingUnits} units.`));
    } else if (r.status === 'impossible') {
      out.replaceChildren(h('p', { className: 'result bad' },
        `${lead}you'd need an average of ${r.needed.toFixed(2)}, which is above the maximum of ${r.scale}. `,
        `The best you can reach is ${r.best.toFixed(2)} with straight A's.`));
    } else {
      const mix = r.mix.map((m) => `${m.units} unit${m.units === 1 ? '' : 's'} at ${m.grade}`).join(' and ');
      out.replaceChildren(h('p', { className: 'result' },
        lead, 'you need an average grade point of ', h('strong', {}, r.needed.toFixed(2)), '. ',
        `For example: ${mix}. The best you can reach is ${r.best.toFixed(2)}.`));
    }
  } catch (err) {
    out.replaceChildren(h('p', { className: 'result bad' }, err.message));
  }
}

async function mutate(path, method, body) {
  try {
    await api(path, { method, body });
    await load();
  } catch (err) {
    showError(err.message);
    await load();
  }
}

function bindForm(selector, path) {
  const form = $(selector);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    try {
      await api(path, { method: 'POST', body });
      form.reset();
      await load();
      form.querySelector('input').focus();
    } catch (err) {
      showError(err.message);
    }
  });
}

bindForm('#course-form', '/courses');
bindForm('#task-form', '/tasks');
$('#target-form').addEventListener('submit', (e) => {
  e.preventDefault();
  updateTarget();
});
$('#scale').addEventListener('change', (e) => mutate('/settings', 'PATCH', { scale: Number(e.target.value) }));

start();
