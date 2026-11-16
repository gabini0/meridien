// Collecte : interroge les flux des sources, normalise, géo-étiquette, classe et regroupe.
// Chaque flux est isolé : la panne d'une source n'interrompt pas les autres, et son état
// (dernier succès, dernière erreur) est conservé pour être affiché aux utilisateurs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeed } from './feed-parser.js';
import { classifyCategory, classifyClaim } from '../editorial/classify.js';
import { tokens, similar, importance } from '../editorial/cluster.js';
import { tx } from '../db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const loadSources = () => JSON.parse(readFileSync(path.join(here, 'sources.json'), 'utf8')).sources;

const CLUSTER_WINDOW_H = 72;

export function createCollector({ db, geo, config, sources = loadSources(), fetchImpl = fetch, log = console }) {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const q = {
    state: db.prepare('SELECT * FROM feed_state WHERE feed_url = ?'),
    upState: db.prepare(`INSERT INTO feed_state (feed_url, source_id, last_attempt, last_success, last_error, failures, etag, last_modified, items_last)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(feed_url) DO UPDATE SET last_attempt=excluded.last_attempt, last_success=excluded.last_success,
      last_error=excluded.last_error, failures=excluded.failures, etag=excluded.etag, last_modified=excluded.last_modified, items_last=excluded.items_last`),
    byUrl: db.prepare('SELECT id, title, excerpt, story_id FROM articles WHERE url = ?'),
    insArticle: db.prepare(`INSERT INTO articles (source_id, url, title, excerpt, lang, published_at, source_updated_at, fetched_at, image_url, author, category, claim_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
    revise: db.prepare('UPDATE articles SET title=?, excerpt=?, revised_at=?, original_title=COALESCE(original_title, ?), source_updated_at=? WHERE id=?'),
    insAT: db.prepare('INSERT OR IGNORE INTO article_territories (article_id, territory_id) VALUES (?,?)'),
    recentStories: db.prepare('SELECT id FROM stories WHERE last_seen >= ? ORDER BY last_seen DESC'),
    storyTitles: db.prepare('SELECT id, title FROM articles WHERE story_id = ?'),
    artTerr: db.prepare('SELECT territory_id FROM article_territories WHERE article_id = ?'),
    storyTerr: db.prepare('SELECT territory_id FROM story_territories WHERE story_id = ?'),
    insStory: db.prepare('INSERT INTO stories (first_seen, last_seen, lead_article_id, category, tokens) VALUES (?,?,?,?,?)'),
    setStory: db.prepare('UPDATE articles SET story_id=? WHERE id=?'),
    storyArticles: db.prepare('SELECT a.id, a.source_id, a.lang, a.category, a.published_at, a.title, a.image_url FROM articles a WHERE a.story_id = ? ORDER BY a.published_at'),
    storyTerrAgg: db.prepare(`SELECT t.territory_id, COUNT(*) n FROM article_territories t JOIN articles a ON a.id = t.article_id WHERE a.story_id = ? GROUP BY t.territory_id`),
    delStoryTerr: db.prepare('DELETE FROM story_territories WHERE story_id = ?'),
    insStoryTerr: db.prepare('INSERT INTO story_territories (story_id, territory_id, mentions) VALUES (?,?,?)'),
    upStory: db.prepare('UPDATE stories SET first_seen=?, last_seen=?, lead_article_id=?, category=?, source_groups=?, article_count=?, importance=?, importance_detail=?, tokens=? WHERE id=?'),
    purgeArticles: db.prepare('DELETE FROM articles WHERE published_at < ?'),
    purgeStories: db.prepare('DELETE FROM stories WHERE id NOT IN (SELECT DISTINCT story_id FROM articles WHERE story_id IS NOT NULL)'),
  };

  async function fetchFeed(source, feed) {
    const now = new Date().toISOString();
    const prev = q.state.get(feed.url);
    const headers = { 'user-agent': config.userAgent, accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8' };
    if (prev?.etag) headers['if-none-match'] = prev.etag;
    if (prev?.last_modified) headers['if-modified-since'] = prev.last_modified;
    try {
      const res = await fetchImpl(feed.url, { headers, signal: AbortSignal.timeout(config.fetchTimeoutMs), redirect: 'follow' });
      if (res.status === 304) {
        q.upState.run(feed.url, source.id, now, now, null, 0, prev.etag, prev.last_modified, 0);
        return { feed: feed.url, ok: true, added: 0, notModified: true };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const items = parseFeed(await res.text());
      const added = tx(db, () => ingest(source, feed, items, now));
      q.upState.run(feed.url, source.id, now, now, null, 0, res.headers.get('etag'), res.headers.get('last-modified'), items.length);
      return { feed: feed.url, ok: true, added, items: items.length };
    } catch (e) {
      const msg = e?.name === 'TimeoutError' ? `Délai dépassé (${config.fetchTimeoutMs} ms)` : String(e?.cause?.code ?? e?.message ?? e).slice(0, 300);
      q.upState.run(feed.url, source.id, now, prev?.last_success ?? null, msg, (prev?.failures ?? 0) + 1, prev?.etag ?? null, prev?.last_modified ?? null, prev?.items_last ?? null);
      log.warn(`[collecte] ${source.id} indisponible : ${msg}`);
      return { feed: feed.url, ok: false, error: msg };
    }
  }

  function ingest(source, feed, items, now) {
    let added = 0;
    const touched = new Set();
    const minDate = new Date(Date.now() - config.retentionDays * 864e5).toISOString();
    for (const it of items) {
      // Une date de publication absente n'est pas inventée : on retient l'heure de collecte et on ne date jamais dans le futur.
      let published = it.publishedAt ?? now;
      if (published > now) published = now;
      if (published < minDate) continue;
      const existing = q.byUrl.get(it.url);
      if (existing) {
        if (existing.title !== it.title || (it.excerpt && existing.excerpt !== it.excerpt)) {
          q.revise.run(it.title, it.excerpt || existing.excerpt, now, existing.title !== it.title ? existing.title : null, it.updatedAt, existing.id);
          if (existing.story_id) touched.add(existing.story_id);
        }
        continue;
      }
      const text = `${it.title}. ${it.excerpt ?? ''}`;
      const terr = geo.tag(text);
      const category = classifyCategory(`${text} ${it.feedCategories.join(' ')}`);
      const claim = classifyClaim(it);
      const { lastInsertRowid: id } = q.insArticle.run(source.id, it.url, it.title, it.excerpt || null, feed.lang, published, it.updatedAt, now, it.imageUrl, it.author, category, claim);
      for (const t of terr) q.insAT.run(id, t);
      touched.add(assign(Number(id), it.title, terr, published, category));
      added++;
    }
    for (const sid of touched) refreshStory(sid);
    return added;
  }

  function assign(articleId, title, terr, published, category) {
    const tk = tokens(title);
    const since = new Date(new Date(published).getTime() - CLUSTER_WINDOW_H * 36e5).toISOString();
    for (const s of q.recentStories.all(since)) {
      for (const art of q.storyTitles.all(s.id)) {
        if (art.id === articleId) continue;
        const aTerr = q.artTerr.all(art.id).map((r) => r.territory_id);
        if (similar(tk, tokens(art.title), terr, aTerr)) { q.setStory.run(s.id, articleId); return s.id; }
      }
    }
    const { lastInsertRowid } = q.insStory.run(published, published, articleId, category, JSON.stringify(tk));
    q.setStory.run(Number(lastInsertRowid), articleId);
    return Number(lastInsertRowid);
  }

  function refreshStory(storyId) {
    const arts = q.storyArticles.all(storyId);
    if (!arts.length) return;
    const groups = new Set(arts.map((a) => sourceById.get(a.source_id)?.group ?? a.source_id));
    const langs = new Set(arts.map((a) => a.lang));
    const cats = {};
    for (const a of arts) if (a.category !== 'other') cats[a.category] = (cats[a.category] ?? 0) + 1;
    const category = Object.entries(cats).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'other';
    const terr = q.storyTerrAgg.all(storyId);
    q.delStoryTerr.run(storyId);
    for (const t of terr) q.insStoryTerr.run(storyId, t.territory_id, t.n);
    const countries = terr.filter((t) => t.territory_id.startsWith('c:')).length;
    const imp = importance({ sourceGroups: groups.size, countries, langs: langs.size, category });
    const lead = arts.find((a) => a.image_url) ?? arts[0];
    const allTokens = [...new Set(arts.flatMap((a) => tokens(a.title)))].slice(0, 60);
    q.upStory.run(arts[0].published_at, arts.at(-1).published_at, lead.id, category, groups.size, arts.length, imp.score, JSON.stringify(imp.parts), JSON.stringify(allTokens), storyId);
  }

  let running = null;
  async function runOnce() {
    if (running) return running;
    running = (async () => {
      const started = Date.now();
      const jobs = sources.flatMap((s) => s.feeds.map((f) => fetchFeed(s, f)));
      const results = await Promise.all(jobs);
      const cutoff = new Date(Date.now() - config.retentionDays * 864e5).toISOString();
      tx(db, () => { q.purgeArticles.run(cutoff); q.purgeStories.run(); });
      const summary = { at: new Date().toISOString(), ms: Date.now() - started, feeds: results.length, ok: results.filter((r) => r.ok).length, added: results.reduce((n, r) => n + (r.added ?? 0), 0), results };
      log.info(`[collecte] ${summary.ok}/${summary.feeds} flux joignables, ${summary.added} nouveaux articles (${summary.ms} ms)`);
      return summary;
    })().finally(() => { running = null; });
    return running;
  }

  function schedule() {
    if (config.collectOnStart) runOnce().catch((e) => log.error(e));
    const timer = setInterval(() => runOnce().catch((e) => log.error(e)), config.collectIntervalMin * 60_000);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  return { runOnce, schedule, sources, ingestForTest: (source, feed, items) => tx(db, () => ingest(source, feed, items, new Date().toISOString())) };
}
