import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db = null;

export function initStore(dbPath = 'data/store.db') {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS commented (
      tweet_id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      author TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_commented_ts ON commented(ts);

    CREATE TABLE IF NOT EXISTS warmup_state (
      target TEXT NOT NULL,
      tweet_id TEXT NOT NULL,
      action TEXT NOT NULL,
      last_action_ts INTEGER NOT NULL,
      PRIMARY KEY(target, tweet_id, action)
    );

    CREATE TABLE IF NOT EXISTS meta (
      k TEXT PRIMARY KEY,
      v TEXT
    );

    CREATE TABLE IF NOT EXISTS in_flight (
      tweet_id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL
    );
  `);
  return db;
}

export function alreadyCommented(tweetId) {
  if (!db) return false;
  const row = db.prepare('SELECT 1 FROM commented WHERE tweet_id = ?').get(tweetId);
  return !!row;
}

export function markCommented(tweetId, author = '') {
  db.prepare('INSERT OR REPLACE INTO commented(tweet_id, ts, author) VALUES(?, ?, ?)')
    .run(tweetId, Date.now(), author);
}

export function commentsInLastHour() {
  if (!db) return 0;
  const since = Date.now() - 60 * 60 * 1000;
  const row = db.prepare('SELECT COUNT(*) AS c FROM commented WHERE ts >= ?').get(since);
  return row.c;
}

export function acquireTweetLock(tweetId, ttlMs = 30 * 60 * 1000) {
  if (!db) return true;
  const now = Date.now();
  db.prepare('DELETE FROM in_flight WHERE ts < ?').run(now - ttlMs);
  const exists = db.prepare('SELECT 1 FROM in_flight WHERE tweet_id = ?').get(tweetId);
  if (exists) return false;
  db.prepare('INSERT INTO in_flight(tweet_id, ts) VALUES(?, ?)').run(tweetId, now);
  return true;
}

export function releaseTweetLock(tweetId) {
  if (!db) return;
  db.prepare('DELETE FROM in_flight WHERE tweet_id = ?').run(tweetId);
}

export function warmupSeen(target, tweetId, action) {
  if (!db) return false;
  const row = db.prepare(
    'SELECT 1 FROM warmup_state WHERE target = ? AND tweet_id = ? AND action = ?'
  ).get(target, tweetId, action);
  return !!row;
}

export function warmupMark(target, tweetId, action) {
  db.prepare(
    'INSERT OR REPLACE INTO warmup_state(target, tweet_id, action, last_action_ts) VALUES(?, ?, ?, ?)'
  ).run(target, tweetId, action, Date.now());
}

export function getMeta(k) {
  if (!db) return null;
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get(k);
  return row ? row.v : null;
}

export function setMeta(k, v) {
  db.prepare('INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)').run(k, String(v));
}

export function recentAuthorCommentCount(author = '', windowMs = 45 * 60 * 1000) {
  if (!db || !author) return 0;
  const since = Date.now() - windowMs;
  const row = db.prepare('SELECT COUNT(*) AS c FROM commented WHERE author = ? AND ts >= ?').get(author, since);
  return row?.c || 0;
}
