import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGpa, classify } from '../src/gpa.js';

test('weights grades by credit units on the 5-point scale', () => {
  const r = computeGpa([{ units: 3, grade: 'A' }, { units: 2, grade: 'C' }]);
  // (3*5 + 2*3) / 5 = 4.2
  assert.equal(r.gpa, 4.2);
  assert.equal(r.totalUnits, 5);
});

test('supports the 4-point scale', () => {
  assert.equal(computeGpa([{ units: 3, grade: 'A' }, { units: 3, grade: 'B' }], 4).gpa, 3.5);
});

test('ignores ungraded (in-progress) courses', () => {
  assert.equal(computeGpa([{ units: 3, grade: 'B' }, { units: 4, grade: null }]).gpa, 4);
});

test('returns 0 with no graded courses', () => {
  assert.deepEqual(computeGpa([]), { gpa: 0, totalUnits: 0, totalPoints: 0, scale: 5 });
});

test('rounds to two decimals', () => {
  // (3*5 + 3*4 + 3*4) / 9 = 4.333...
  assert.equal(computeGpa([{ units: 3, grade: 'A' }, { units: 3, grade: 'B' }, { units: 3, grade: 'B' }]).gpa, 4.33);
});

test('rejects unknown scales', () => {
  assert.throws(() => computeGpa([], 10), /Unsupported scale/);
});

test('classifies degree class on band boundaries', () => {
  assert.equal(classify(4.5, 5), 'First Class');
  assert.equal(classify(4.49, 5), 'Second Class Upper');
  assert.equal(classify(2.4, 5), 'Second Class Lower');
  assert.equal(classify(0.9, 5), 'Fail');
  assert.equal(classify(3.6, 4), 'First Class');
});
