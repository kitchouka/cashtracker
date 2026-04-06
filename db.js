const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    color TEXT DEFAULT '#6366f1',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    icon TEXT,
    color TEXT
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'EUR',
    merchant TEXT,
    category_id INTEGER REFERENCES categories(id),
    date TEXT NOT NULL,
    note TEXT,
    scope TEXT DEFAULT 'personal' CHECK(scope IN ('personal', 'family')),
    receipt_path TEXT,
    source TEXT DEFAULT 'manual' CHECK(source IN ('manual', 'ocr', 'import')),
    raw_label TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed categories
const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get().c;
if (catCount === 0) {
  const insertCat = db.prepare('INSERT INTO categories (name, icon, color) VALUES (?, ?, ?)');
  const cats = [
    ['Alimentation', '🛒', '#22c55e'],
    ['Transport',    '🚗', '#3b82f6'],
    ['Maison',       '🏠', '#f59e0b'],
    ['Sorties',      '🎉', '#ec4899'],
    ['Santé',        '💊', '#14b8a6'],
    ['Vêtements',    '👕', '#8b5cf6'],
    ['Divers',       '📦', '#6b7280'],
  ];
  for (const c of cats) insertCat.run(...c);
}

// Seed users
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const insertUser = db.prepare('INSERT INTO users (name, email, color) VALUES (?, ?, ?)');
  insertUser.run('Julien',  'julien@famille.local',  '#6366f1');
  insertUser.run('Famille', 'famille@famille.local', '#ec4899');
}

module.exports = db;
