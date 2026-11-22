# StudyDesk

A small full-stack student planner. Track your courses and grades, see your GPA/CGPA
and degree class update live, and keep on top of assignments and deadlines.

- **Courses** grouped by semester, with credit units and grades (A–F)
- **GPA per semester and overall CGPA**, weighted by credit units, on a **5.0 or 4.0 scale**
- **Degree class** (First Class, Second Class Upper, …) from your CGPA
- **Tasks** with due dates, optional course link, overdue / due-soon highlighting
- Works on phones, supports dark mode

## Run it

Requires Node.js 18+.

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # same, restarts on file changes
npm test
```

Data is saved to `data/db.json`. Override with `PORT` and `DB_PATH` environment variables.

## Project layout

```
src/
  server.js     entry point: reads env, starts the server
  app.js        Express app and REST routes
  store.js      JSON-file storage (atomic writes)
  gpa.js        GPA calculation and degree classification
  validate.js   request body validation
public/         frontend: plain HTML, CSS and JavaScript (no build step)
test/           unit tests (gpa) and API tests, using node:test
```

## API

| Method | Path | Notes |
| --- | --- | --- |
| GET / POST | `/api/courses` | `{ code, title, units, grade, semester }` |
| PATCH / DELETE | `/api/courses/:id` | PATCH accepts any subset of fields; deleting unlinks its tasks |
| GET / POST | `/api/tasks` | `{ title, dueDate: "YYYY-MM-DD", courseId, done }` |
| PATCH / DELETE | `/api/tasks/:id` | |
| GET / PATCH | `/api/settings` | `{ scale: 4 \| 5 }` |
| GET | `/api/summary` | `{ gpa, totalUnits, degreeClass, semesters: [...] }` |

Validation errors return `400` with `{ "errors": ["..."] }`.

## Ideas for next steps

- User accounts, so several students can use one server
- A "what grade do I need?" target-CGPA calculator
- Swap the JSON file for SQLite once data grows
- Deploy to Render or Railway
