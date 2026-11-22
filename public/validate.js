import { GRADES } from './gpa.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Each validator returns { value, errors }. `partial` allows PATCH-style updates.

export function validateCourse(body = {}, { partial = false } = {}) {
  const errors = [];
  const value = {};

  if (!partial || 'code' in body) {
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!code) errors.push('code is required');
    else if (code.length > 20) errors.push('code must be at most 20 characters');
    value.code = code;
  }
  if (!partial || 'title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (title.length > 120) errors.push('title must be at most 120 characters');
    value.title = title;
  }
  if (!partial || 'units' in body) {
    const units = Number(body.units);
    if (!Number.isInteger(units) || units < 0 || units > 12) errors.push('units must be a whole number from 0 to 12');
    value.units = units;
  }
  if (!partial || 'grade' in body) {
    const grade = body.grade ? String(body.grade).toUpperCase() : null;
    if (grade && !GRADES.includes(grade)) errors.push(`grade must be one of ${GRADES.join(', ')} or empty`);
    value.grade = grade;
  }
  if (!partial || 'semester' in body) {
    value.semester = typeof body.semester === 'string' && body.semester.trim() ? body.semester.trim() : 'Unassigned';
  }
  return { value, errors };
}

export function validateTask(body = {}, { partial = false } = {}) {
  const errors = [];
  const value = {};

  if (!partial || 'title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) errors.push('title is required');
    else if (title.length > 200) errors.push('title must be at most 200 characters');
    value.title = title;
  }
  if (!partial || 'dueDate' in body) {
    const due = body.dueDate || null;
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) errors.push('dueDate must be YYYY-MM-DD');
    value.dueDate = due;
  }
  if (!partial || 'courseId' in body) {
    const courseId = body.courseId || null;
    if (courseId && !UUID.test(courseId)) errors.push('courseId is not valid');
    value.courseId = courseId;
  }
  if (!partial || 'done' in body) {
    value.done = Boolean(body.done);
  }
  return { value, errors };
}
