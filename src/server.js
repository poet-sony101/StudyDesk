// Entry point. Locally (`npm start`) this starts a server; on Vercel the exported
// app is used directly and Vercel handles the listening.
import { createApp } from './createApp.js';
import { getDb } from './db.js';

const app = createApp({ getDb });
export default app;

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    const where = process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'Postgres (DATABASE_URL)' : 'local database in ./data/pglite';
    console.log(`StudyDesk running at http://localhost:${port} using ${where}`);
  });
}
