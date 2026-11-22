# StudyDesk

A small full-stack student planner. Track your courses and grades, see your GPA/CGPA
and degree class update live, and keep on top of assignments and deadlines.

- **Courses** grouped by semester, with credit units and grades (A–F)
- **GPA per semester and overall CGPA**, weighted by credit units, on a **5.0 or 4.0 scale**
- **Degree class** (First Class, Second Class Upper, …) from your CGPA
- **Target CGPA planner**: the average you need over your remaining units, a grade mix that gets you there, and the best CGPA you can still reach
- **Edit anything** inline (✎): courses and tasks; Enter saves, Escape cancels
- **Tasks** with due dates, optional course link, overdue / due-soon highlighting
- **Student accounts**: sign up with email + password; each student only sees their own data
- Works on phones, supports dark mode

## Run it

Requires Node.js 18+.

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # same, restarts on file changes
npm test
```

Locally, data is saved in an embedded Postgres database in `data/pglite` (nothing to install).
Set `DATABASE_URL` to use a real Postgres server instead.

## Deploy on Vercel

1. Import the GitHub repo into Vercel (no build settings needed).
2. In the Vercel project, open **Storage → Create Database → Neon (Postgres)** and connect it to the project.
   This sets `DATABASE_URL` for you.
3. Redeploy. Tables are created automatically on first request.

## Security notes

- Passwords are hashed with scrypt and a per-user salt; plain passwords are never stored.
- Sessions use a random token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` over HTTPS); only a hash of the token is stored.
- Every data query is filtered by the signed-in user's id.
- Not yet included: password reset by email and login rate limiting.

## Project layout

```
src/
  server.js     entry point: exports the app (Vercel) and listens locally
  createApp.js  Express app and REST routes
  auth.js       password hashing, session cookies
  db.js         database connection and schema (Postgres / embedded PGlite)
  store.js      per-user data access
  gpa.js        GPA calculation and degree classification
  validate.js   request body validation
public/         frontend: plain HTML, CSS and JavaScript (no build step)
test/           unit tests (gpa) and API tests, using node:test
```

## API

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/signup`, `/api/auth/login` | `{ email, password }`; sets the session cookie |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | `{ user: { email } }` or 401 |
| GET / POST | `/api/courses` | `{ code, title, units, grade, semester }` |
| PATCH / DELETE | `/api/courses/:id` | PATCH accepts any subset of fields; deleting unlinks its tasks |
| GET / POST | `/api/tasks` | `{ title, dueDate: "YYYY-MM-DD", courseId, done }` |
| PATCH / DELETE | `/api/tasks/:id` | |
| GET / PATCH | `/api/settings` | `{ scale: 4 \| 5 }` |
| GET | `/api/summary` | `{ gpa, totalUnits, degreeClass, semesters: [...] }` |
| GET | `/api/target?cgpa=4.5&units=18` | `units` defaults to ungraded units; returns `{ status, needed, mix, best }` |

All routes except signup/login/logout require a session (401 otherwise).
Validation errors return `400` with `{ "errors": ["..."] }`.

## Ideas for next steps

- Password reset by email
- Login rate limiting
- Import data from the old `data/db.json` file
