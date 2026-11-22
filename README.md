# StudyDesk

A student planner that runs entirely in your browser. Track your courses and grades,
see your GPA/CGPA and degree class update live, plan the grades you need for a target
CGPA, and keep on top of assignments and deadlines.

- **Courses** grouped by semester, with credit units and grades (A–F)
- **GPA per semester and overall CGPA**, weighted by credit units, on a **5.0 or 4.0 scale**
- **Degree class** (First Class, Second Class Upper, …) from your CGPA
- **Target CGPA planner**: the average you need over your remaining units, a grade mix that gets you there, and the best CGPA you can still reach
- **Edit anything** inline (✎): courses and tasks; Enter saves, Escape cancels
- **Tasks** with due dates, optional course link, overdue / due-soon highlighting
- **Export / Import** a backup file to keep your data safe or move it to another device
- Works on phones, supports dark mode

## Where your data lives

There is no server, database or login. Everything is saved in your browser's
`localStorage`, so it is private to that browser on that device:

- Clearing your browser data, or using a different browser or device, starts empty.
- Use **Export** to download a backup (`studydesk-backup-YYYY-MM-DD.json`), and
  **Import** to load it anywhere. Import replaces what's in that browser (it asks first).
- Import also accepts the `data/db.json` file from the earliest server version of StudyDesk.

## Run it locally

Requires Node.js 18+. No packages to install.

```bash
npm start          # http://localhost:3000
npm test
```

## Deploy on Vercel

Import the GitHub repo into Vercel. `vercel.json` tells it to serve the `public/` folder
as a static site; there's nothing else to configure.

## Project layout

```
public/              the whole app (plain HTML, CSS and JavaScript modules, no build step)
  index.html
  styles.css
  app.js             UI: rendering, forms, editing, export/import
  localApi.js        data storage in localStorage, with validation and import/export
  gpa.js             GPA, degree class and target CGPA calculations
  validate.js        validation rules for courses and tasks
scripts/dev-server.js  tiny static file server for `npm start`
test/                tests for the calculations and the storage layer (node:test)
vercel.json
```

## Ideas for next steps

- Optional cloud sync, for using the same data on several devices without export/import
- Print / PDF view of your results per semester
- Reminders for tasks that are due soon
