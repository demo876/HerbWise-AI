const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new Database(path.join(dir, 'herbwise.db'));
db.exec(`DROP TABLE IF EXISTS plants;
CREATE TABLE IF NOT EXISTS herbs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sci_key TEXT NOT NULL UNIQUE, sci TEXT NOT NULL, en TEXT DEFAULT '', hi TEXT DEFAULT '', kn TEXT DEFAULT '',
  family TEXT DEFAULT '', types TEXT DEFAULT '', popular INTEGER DEFAULT 0, toxic INTEGER DEFAULT 0,
  parts TEXT DEFAULT '', uses TEXT DEFAULT '', prep TEXT DEFAULT '', benefits TEXT DEFAULT '', evidence TEXT DEFAULT '',
  precautions TEXT DEFAULT '', description TEXT DEFAULT '', image TEXT DEFAULT '', source_url TEXT DEFAULT '',
  enriched INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0, img_tried INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS translations (herb_id INTEGER, lang TEXT, scope TEXT, data TEXT, PRIMARY KEY (herb_id, lang, scope));
CREATE INDEX IF NOT EXISTS idx_herbs_en ON herbs(en);`);
module.exports = db;
