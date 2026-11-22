// Grade-point tables for the supported grading scales.
export const SCALES = {
  5: { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 },
  4: { A: 4, B: 3, C: 2, D: 1, E: 0, F: 0 },
};

export const GRADES = Object.keys(SCALES[5]);

/**
 * Compute GPA from a list of courses: [{ units, grade }].
 * Courses without a grade (still in progress) are ignored.
 */
export function computeGpa(courses, scale = 5) {
  const table = SCALES[scale];
  if (!table) throw new Error(`Unsupported scale: ${scale}`);

  let totalUnits = 0;
  let totalPoints = 0;
  for (const { units, grade } of courses) {
    if (!grade) continue;
    totalUnits += units;
    totalPoints += units * table[grade];
  }
  const gpa = totalUnits === 0 ? 0 : Math.round((totalPoints / totalUnits) * 100) / 100;
  return { gpa, totalUnits, totalPoints, scale };
}

/** Degree class for a GPA on the given scale. */
export function classify(gpa, scale = 5) {
  const bands = scale === 5
    ? [[4.5, 'First Class'], [3.5, 'Second Class Upper'], [2.4, 'Second Class Lower'], [1.5, 'Third Class'], [1.0, 'Pass']]
    : [[3.5, 'First Class'], [3.0, 'Second Class Upper'], [2.0, 'Second Class Lower'], [1.0, 'Third Class']];
  for (const [min, label] of bands) if (gpa >= min) return label;
  return 'Fail';
}

// Grade letter for a whole grade point; F is preferred over E when both are 0 (4-point scale).
function letterFor(points, scale) {
  const table = SCALES[scale];
  return ['A', 'B', 'C', 'D', 'F', 'E'].find((g) => table[g] === points);
}

/**
 * What average grade point is needed over `remainingUnits` more units to reach `target` CGPA?
 * Returns the required average, whether it is achievable, the best possible CGPA,
 * and a simple unit mix of two adjacent grades that reaches the target.
 */
export function planTarget(courses, { target, remainingUnits, scale = 5 }) {
  const table = SCALES[scale];
  if (!table) throw new Error(`Unsupported scale: ${scale}`);
  const max = table.A;
  const { gpa, totalUnits, totalPoints } = computeGpa(courses, scale);
  const R = remainingUnits;

  const needed = (target * (totalUnits + R) - totalPoints) / R;
  const best = Math.round(((totalPoints + max * R) / (totalUnits + R)) * 100) / 100;
  const result = { current: gpa, target, remainingUnits: R, scale, best, needed: Math.round(needed * 100) / 100 };

  if (needed <= 0) return { ...result, status: 'secured', mix: [] };
  if (needed > max + 1e-9) return { ...result, status: 'impossible', mix: [] };

  // Split the units between the two grades around the needed average.
  const low = Math.floor(needed + 1e-9);
  const high = Math.min(low + 1, max);
  const highUnits = low === high ? R : Math.min(R, Math.ceil((needed - low) * R - 1e-9));
  const mix = [
    { grade: letterFor(high, scale), units: highUnits },
    { grade: letterFor(low, scale), units: R - highUnits },
  ].filter((m) => m.units > 0);

  return { ...result, status: 'possible', mix };
}
