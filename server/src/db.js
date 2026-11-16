import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS feed_state (
  feed_url TEXT PRIMARY KEY, source_id TEXT NOT NULL,
  last_attempt TEXT, last_success TEXT, last_error TEXT,
  failures INTEGER NOT NULL DEFAULT 0, etag TEXT, last_modified TEXT, items_last INTEGER
);
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  lead_article_id INTEGER, category TEXT NOT NULL DEFAULT 'other',
  source_groups INTEGER NOT NULL DEFAULT 1, article_count INTEGER NOT NULL DEFAULT 1,
  importance INTEGER NOT NULL DEFAULT 0, importance_detail TEXT,
  importance_override TEXT,              -- fixé par la rédaction : major | important | notable
  review_status TEXT NOT NULL DEFAULT 'auto', -- auto | validated | disputed | corrected
  review_note_fr TEXT, review_note_en TEXT, reviewed_at TEXT,
  tokens TEXT
);
CREATE INDEX IF NOT EXISTS stories_last_seen ON stories(last_seen);
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, excerpt TEXT, lang TEXT NOT NULL,
  published_at TEXT NOT NULL, source_updated_at TEXT, fetched_at TEXT NOT NULL,
  image_url TEXT, author TEXT, category TEXT NOT NULL DEFAULT 'other', claim_type TEXT NOT NULL DEFAULT 'report',
  story_id INTEGER REFERENCES stories(id),
  revised_at TEXT, original_title TEXT   -- renseignés quand la source a modifié l'article après collecte
);
CREATE INDEX IF NOT EXISTS articles_story ON articles(story_id);
CREATE INDEX IF NOT EXISTS articles_published ON articles(published_at);
CREATE TABLE IF NOT EXISTS article_territories (
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, territory_id TEXT NOT NULL,
  PRIMARY KEY (article_id, territory_id)
);
CREATE INDEX IF NOT EXISTS at_territory ON article_territories(territory_id);
CREATE TABLE IF NOT EXISTS story_territories (
  story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE, territory_id TEXT NOT NULL, mentions INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (story_id, territory_id)
);
CREATE INDEX IF NOT EXISTS st_territory ON story_territories(territory_id);
CREATE TABLE IF NOT EXISTS translations (
  hash TEXT NOT NULL, lang TEXT NOT NULL, text TEXT NOT NULL, provider TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY (hash, lang)
);
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relation_analyses (
  pair TEXT NOT NULL, lang TEXT NOT NULL, body TEXT NOT NULL, sources TEXT NOT NULL,
  origin TEXT NOT NULL,                  -- editorial | automatic
  status TEXT NOT NULL,                  -- published | unreviewed
  created_at TEXT NOT NULL, PRIMARY KEY (pair, lang)
);
`;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
