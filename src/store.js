import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const EMPTY = () => ({ courses: [], tasks: [], settings: { scale: 5 } });

/**
 * Tiny JSON-file store. Pass ':memory:' to keep data in memory only (used by tests).
 * Writes go to a temp file first, then get renamed, so a crash never leaves half a file.
 */
export function createStore(path) {
  let data = EMPTY();
  if (path !== ':memory:' && existsSync(path)) {
    data = { ...EMPTY(), ...JSON.parse(readFileSync(path, 'utf8')) };
  }

  function save() {
    if (path === ':memory:') return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 2));
    renameSync(`${path}.tmp`, path);
  }

  function collection(name) {
    return {
      list: () => data[name],
      get: (id) => data[name].find((item) => item.id === id),
      create(fields) {
        const item = { id: randomUUID(), createdAt: new Date().toISOString(), ...fields };
        data[name].push(item);
        save();
        return item;
      },
      update(id, fields) {
        const item = data[name].find((i) => i.id === id);
        if (!item) return null;
        Object.assign(item, fields);
        save();
        return item;
      },
      remove(id) {
        const before = data[name].length;
        data[name] = data[name].filter((i) => i.id !== id);
        if (data[name].length === before) return false;
        save();
        return true;
      },
    };
  }

  return {
    courses: collection('courses'),
    tasks: collection('tasks'),
    getSettings: () => data.settings,
    updateSettings(fields) {
      Object.assign(data.settings, fields);
      save();
      return data.settings;
    },
  };
}
