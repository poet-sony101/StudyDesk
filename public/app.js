const $ = (sel) => document.querySelector(sel);
const state = { courses: [], tasks: [], summary: null, settings: { scale: 5 } };

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.errors?.join(', ') || 'Request failed');
  return data;
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
}

function renderCourses(courses, semesters) {
  const root = $('#courses');
  if (!courses.length) return root.replaceChildren(h('p', { className: 'empty' }, 'No courses yet. Add your first one above.'));

  root.replaceChildren(...semesters.map((sem) => {
    const rows = courses.filter((c) => c.semester === sem.name).map((c) => {
      const grade = h('select', { ariaLabel: `Grade for ${c.code}` },
        h('option', { value: '' }, '—'),
        ...['A', 'B', 'C', 'D', 'E', 'F'].map((g) => h('option', { value: g, selected: c.grade === g }, g)));
      grade.addEventListener('change', () => mutate(`/courses/${c.id}`, 'PATCH', { grade: grade.value || null }));

      const del = h('button', { className: 'link', type: 'button', ariaLabel: `Delete ${c.code}`, title: 'Delete course' }, '✕');
      del.addEventListener('click', () => confirm(`Delete ${c.code}?`) && mutate(`/courses/${c.id}`, 'DELETE'));

      return h('tr', {}, h('td', {}, c.code), h('td', {}, c.title), h('td', { className: 'num' }, String(c.units)),
        h('td', {}, grade), h('td', { className: 'num' }, del));
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
    const course = courses.find((c) => c.id === t.courseId);
    const box = h('input', { type: 'checkbox', checked: t.done, ariaLabel: `Mark ${t.title} done` });
    box.addEventListener('change', () => mutate(`/tasks/${t.id}`, 'PATCH', { done: box.checked }));
    const del = h('button', { className: 'link', type: 'button', ariaLabel: `Delete ${t.title}` }, 'Delete');
    del.addEventListener('click', () => mutate(`/tasks/${t.id}`, 'DELETE'));

    return h('li', { className: t.done ? 'done' : '' },
      box, h('span', { className: 'title' }, t.title),
      course ? h('span', { className: 'tag' }, course.code) : null,
      dueLabel(t.dueDate), del);
  }));
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
$('#scale').addEventListener('change', (e) => mutate('/settings', 'PATCH', { scale: Number(e.target.value) }));

load().catch((err) => showError(err.message));
