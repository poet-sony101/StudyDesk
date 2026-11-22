import { createApp } from './app.js';
import { createStore } from './store.js';

const port = Number(process.env.PORT) || 3000;
const dbPath = process.env.DB_PATH || 'data/db.json';

createApp(createStore(dbPath)).listen(port, () => {
  console.log(`StudyDesk running at http://localhost:${port}`);
});
