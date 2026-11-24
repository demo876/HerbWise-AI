
const db = require('better-sqlite3')('./data/herbwise.db');

const rows = db.prepare(`
  SELECT en, sci, image
  FROM herbs
  WHERE image IS NOT NULL
    AND length(image) > 0
  ORDER BY id DESC
  LIMIT 12
`).all();

console.log('\nLATEST SAVED PLANT IMAGES:\n');

console.table(rows);

console.log('\nTotal displayed:', rows.length);

db.close();
