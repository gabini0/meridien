import express from 'express';
import path from 'node:path';
import { CATEGORIES } from '../editorial/classify.js';
import { levelOf } from '../editorial/cluster.js';

const PERIODS = { today: 24, week: 24 * 7, month: 24 * 30 };
const LANGS = ['fr', 'en'];
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, code) => Object.assign(new Error(code), { status, code });

export function createApi({ db, geo, config, collector, context, llm }) {
  const api = express.Router();
  api.use(express.json({ limit: '200kb' }));
  const sources = new Map(collector.sources.map((s) => [s.id, s]));
  const lang = (req) => (LANGS.includes(req.query.lang) ? req.query.lang : 'fr');
  const since = (req) => new Date(Date.now() - (PERIODS[req.query.period] ?? PERIODS.week) * 36e5).toISOString();
  const terr = (id) => { const t = geo.byId.get(id); if (!t) throw fail(404, 'territory_not_found'); return t; };
  const brief = (t, l) => ({ id: t.id, type: t.type, name: t.name[l], lon: t.lon, lat: t.lat, country: t.country ?? null });

  /** Expression SQL : ids des territoires couverts par une sélection (un continent couvre ses pays). */
  function scope(t) {
    if (t.type !== 'continent') return [t.id];
    return geo.territories.filter((x) => x.type === 'country' && x.continent === t.id).map((x) => x.id);
  }

  const qArticles = db.prepare('SELECT * FROM articles WHERE story_id = ? ORDER BY published_at');
  const qStoryTerr = db.prepare('SELECT territory_id, mentions FROM story_territories WHERE story_id = ? ORDER BY mentions DESC');

  function article(a, l) {
    const s = sources.get(a.source_id);
    const sameLang = a.lang === l;
    const tTitle = sameLang ? null : llm.cached(a.title, l);
    const tExcerpt = sameLang ? null : llm.cached(a.excerpt, l);
    return {
      id: a.id, url: a.url, lang: a.lang, publishedAt: a.published_at, fetchedAt: a.fetched_at,
      title: tTitle ?? a.title, excerpt: tExcerpt ?? a.excerpt, translated: !!tTitle,
      originalTitle: tTitle ? a.title : null,
      source: { id: a.source_id, name: s?.name ?? a.source_id, homepage: s?.homepage ?? null, primary: !!s?.primary },
      author: a.author, imageUrl: a.image_url, category: a.category, claimType: a.claim_type,
      revisedAt: a.revised_at, previousTitle: a.original_title,
    };
  }

  function story(row, l, full = false) {
    const arts = qArticles.all(row.id);
    // Article d'en-tête : de préférence dans la langue de l'interface.
    const lead = arts.find((a) => a.lang === l && a.id === row.lead_article_id) ?? arts.find((a) => a.lang === l) ?? arts.find((a) => a.id === row.lead_article_id) ?? arts[0];
    const image = arts.find((a) => a.id === row.lead_article_id && a.image_url) ?? arts.find((a) => a.image_url);
    const territories = qStoryTerr.all(row.id).map((r) => geo.byId.get(r.territory_id)).filter(Boolean);
    const place = territories.find((t) => t.type === 'city') ?? territories[0];
    const out = {
      id: row.id, firstSeen: row.first_seen, lastSeen: row.last_seen, category: row.category,
      lead: lead ? article(lead, l) : null,
      image: image ? { url: image.image_url, credit: sources.get(image.source_id)?.name ?? image.source_id, articleUrl: image.url } : null,
      territories: territories.map((t) => brief(t, l)),
      location: place ? brief(place, l) : null,
      importance: { level: row.importance_override ?? levelOf(row.importance), score: row.importance, setBy: row.importance_override ? 'editorial' : 'automatic', criteria: JSON.parse(row.importance_detail ?? '[]') },
      verification: {
        status: row.review_status !== 'auto' ? row.review_status : row.source_groups >= 2 ? 'corroborated' : 'single_source',
        independentSources: row.source_groups, articles: row.article_count,
        note: row[`review_note_${l}`] ?? null, reviewedAt: row.reviewed_at,
      },
      updated: arts.some((a) => a.revised_at),
      sources: [...new Map(arts.map((a) => [a.source_id, { id: a.source_id, name: sources.get(a.source_id)?.name ?? a.source_id }])).values()],
    };
    if (full) out.articles = arts.map((a) => article(a, l));
    return out;
  }

  // ---- État et sources ---------------------------------------------------
  api.get('/status', (req, res) => {
    const feeds = db.prepare('SELECT * FROM feed_state').all();
    const last = feeds.map((f) => f.last_success).filter(Boolean).sort().at(-1) ?? null;
    res.json({
      articles: db.prepare('SELECT COUNT(*) n FROM articles').get().n,
      stories: db.prepare('SELECT COUNT(*) n FROM stories').get().n,
      lastSuccessfulCollection: last,
      feeds: { total: collector.sources.reduce((n, s) => n + s.feeds.length, 0), reachable: feeds.filter((f) => f.failures === 0 && f.last_success).length, attempted: feeds.length },
      features: { translation: llm.enabled, relationAnalysis: llm.enabled, editorialReview: !!config.adminToken },
      categories: CATEGORIES,
    });
  });

  api.get('/sources', (req, res) => {
    const state = new Map(db.prepare('SELECT * FROM feed_state').all().map((f) => [f.feed_url, f]));
    res.json(collector.sources.map((s) => ({
      id: s.id, name: s.name, homepage: s.homepage, country: s.country, primary: !!s.primary, group: s.group,
      feeds: s.feeds.map((f) => { const st = state.get(f.url); return { url: f.url, lang: f.lang, lastAttempt: st?.last_attempt ?? null, lastSuccess: st?.last_success ?? null, error: st?.last_error ?? null, failures: st?.failures ?? 0 }; }),
    })));
  });

  // ---- Géographie --------------------------------------------------------
  const staticGeo = (file, type) => (req, res) => res.type(type).set('cache-control', 'public, max-age=86400').sendFile(path.join(config.geoDir, file));
  api.get('/geo/countries.geojson', staticGeo('countries.geojson', 'application/geo+json'));
  api.get('/geo/search-index.json', staticGeo('search-index.json', 'application/json'));

  api.get('/territories/:id', (req, res) => {
    const t = terr(req.params.id), l = lang(req);
    const parent = t.country ? geo.byId.get(t.country) : null;
    const continent = t.continent ? geo.byId.get(t.continent) : null;
    res.json({
      ...brief(t, l), names: t.name, officialName: t.officialName?.[l] ?? null,
      parent: parent ? brief(parent, l) : null, continent: continent ? brief(continent, l) : null,
      subregion: t.subregion ?? null, zoom: t.zoom ?? null,
      facts: t.type === 'country' ? { iso2: t.iso2, iso3: t.iso3, capital: t.capital, area: t.area, languages: t.languages, currencies: t.currencies, landlocked: t.landlocked, unMember: t.unMember, flag: t.flag, borders: t.borders.map((b) => brief(geo.byId.get(b), l)) }
        : t.type === 'city' ? { population: t.population, capital: !!t.capital }
        : t.type === 'region' ? { isoCode: t.isoCode }
        : { countries: scope(t).length },
    });
  });

  api.get('/territories/:id/context', wrap(async (req, res) => res.json(await context.territory(terr(req.params.id), lang(req)))));

  // ---- Actualités --------------------------------------------------------
  api.get('/stories', (req, res) => {
    const l = lang(req);
    const limit = Math.min(Number(req.query.limit) || 20, 50), offset = Math.max(Number(req.query.offset) || 0, 0);
    const where = ['s.last_seen >= ?'], params = [since(req)];
    if (CATEGORIES.includes(req.query.category)) { where.push('s.category = ?'); params.push(req.query.category); }
    for (const id of String(req.query.territory ?? '').split(',').filter(Boolean).slice(0, 2)) {
      const ids = scope(terr(id));
      where.push(`s.id IN (SELECT story_id FROM story_territories WHERE territory_id IN (${ids.map(() => '?').join(',')}))`);
      params.push(...ids);
    }
    const order = req.query.sort === 'recent' ? 's.last_seen DESC' : `CASE COALESCE(s.importance_override, '') WHEN 'major' THEN 100 WHEN 'important' THEN 50 WHEN 'notable' THEN 10 ELSE s.importance END DESC, s.last_seen DESC`;
    const rows = db.prepare(`SELECT s.* FROM stories s WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit + 1, offset);
    const total = db.prepare(`SELECT COUNT(*) n FROM stories s WHERE ${where.join(' AND ')}`).get(...params).n;
    res.json({ total, hasMore: rows.length > limit, items: rows.slice(0, limit).map((r) => story(r, l)) });
  });

  api.get('/stories/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM stories WHERE id = ?').get(Number(req.params.id));
    if (!row) throw fail(404, 'story_not_found');
    res.json(story(row, lang(req), true));
  });

  api.post('/stories/:id/translate', wrap(async (req, res) => {
    const l = lang(req);
    const arts = qArticles.all(Number(req.params.id)).filter((a) => a.lang !== l);
    if (!arts.length) return res.json({ translated: 0 });
    await llm.translate(arts.flatMap((a) => [a.title, a.excerpt]).filter(Boolean), l);
    res.json({ translated: arts.length, provider: llm.provider });
  }));

  /** Nombre de sujets par pays sur la période : alimente la couche d'activité de la carte. */
  api.get('/map/activity', (req, res) => {
    const where = ['s.last_seen >= ?', "t.territory_id LIKE 'c:%'"], params = [since(req)];
    if (CATEGORIES.includes(req.query.category)) { where.push('s.category = ?'); params.push(req.query.category); }
    const rows = db.prepare(`SELECT t.territory_id id, COUNT(*) n, MAX(s.importance) top FROM story_territories t JOIN stories s ON s.id = t.story_id WHERE ${where.join(' AND ')} GROUP BY t.territory_id`).all(...params);
    res.json(rows.map((r) => ({ id: r.id, stories: r.n, topLevel: levelOf(r.top) })));
  });

  // ---- Relations entre territoires --------------------------------------
  const qRel = db.prepare('SELECT * FROM relation_analyses WHERE pair = ? AND lang = ?');
  const coStories = (a, b, hours) => {
    const A = scope(a), B = scope(b), ph = (x) => x.map(() => '?').join(',');
    return db.prepare(`SELECT s.* FROM stories s WHERE s.last_seen >= ?
      AND s.id IN (SELECT story_id FROM story_territories WHERE territory_id IN (${ph(A)}))
      AND s.id IN (SELECT story_id FROM story_territories WHERE territory_id IN (${ph(B)}))
      ORDER BY s.last_seen DESC LIMIT 60`).all(new Date(Date.now() - hours * 36e5).toISOString(), ...A, ...B);
  };

  function structural(a, b, l) {
    const ca = a.type === 'country' ? a : geo.byId.get(a.country), cb = b.type === 'country' ? b : geo.byId.get(b.country);
    const R = 6371, rad = (d) => (d * Math.PI) / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    return {
      sameCountry: !!ca && ca === cb && a !== b,
      sharedBorder: a.type === 'country' && b.type === 'country' ? a.borders.includes(b.id) : null,
      sameContinent: a.continent && a.continent === b.continent ? brief(geo.byId.get(a.continent), l) : null,
      distanceKm: a.lat != null && b.lat != null ? Math.round(2 * R * Math.asin(Math.sqrt(h))) : null,
      sharedLanguages: a.type === 'country' && b.type === 'country' ? a.languages.filter((x) => b.languages.includes(x)) : [],
      sharedCurrencies: a.type === 'country' && b.type === 'country' ? a.currencies.filter((x) => b.currencies.includes(x)) : [],
    };
  }

  api.get('/relations', wrap(async (req, res) => {
    const a = terr(req.query.a), b = terr(req.query.b), l = lang(req);
    if (a === b) throw fail(400, 'same_territory');
    const rows = coStories(a, b, PERIODS.month);
    const byCategory = {};
    for (const r of rows) (byCategory[r.category] ??= []).push(story(r, l));
    const ca = a.type === 'country' ? a : geo.byId.get(a.country), cb = b.type === 'country' ? b : geo.byId.get(b.country);
    const ctx = ca && cb && ca !== cb ? await context.relation(ca, cb, l) : { available: false, reason: 'unsupported' };
    const saved = qRel.get(geo.pairKey(a.id, b.id), l);
    res.json({
      a: brief(a, l), b: brief(b, l), structural: structural(a, b, l),
      context: ctx, contextScope: ca && cb && ca !== cb && (a !== ca || b !== cb) ? { a: brief(ca, l), b: brief(cb, l) } : null,
      news: { total: rows.length, windowDays: 30, byCategory },
      analysis: saved ? { origin: saved.origin, status: saved.status, createdAt: saved.created_at, body: JSON.parse(saved.body), sources: JSON.parse(saved.sources) } : null,
      // Données non couvertes à ce jour, signalées explicitement plutôt que simulées.
      unavailable: ['bilateral_trade_figures', 'treaty_register'],
      canGenerate: llm.enabled,
    });
  }));

  api.post('/relations/analysis', wrap(async (req, res) => {
    const a = terr(req.body?.a), b = terr(req.body?.b), l = LANGS.includes(req.body?.lang) ? req.body.lang : 'fr';
    const key = geo.pairKey(a.id, b.id);
    const existing = qRel.get(key, l);
    if (existing?.origin === 'editorial') throw fail(409, 'editorial_analysis_exists');
    if (existing && Date.now() - new Date(existing.created_at).getTime() < 6 * 36e5) return res.json({ reused: true });
    const ca = a.type === 'country' ? a : geo.byId.get(a.country), cb = b.type === 'country' ? b : geo.byId.get(b.country);
    const ctx = ca && cb && ca !== cb ? await context.relation(ca, cb, l) : {};
    const srcs = [], lines = [];
    if (ctx.article) { srcs.push({ publisher: 'Wikipédia', title: ctx.article.title, url: ctx.article.url, date: ctx.article.revised?.slice(0, 10) ?? null, kind: 'encyclopedia' }); lines.push(`[${srcs.length}] (encyclopedia) ${ctx.article.extract}`); }
    if (ctx.sharedOrganizations?.length) { srcs.push({ publisher: 'Wikidata', title: `${ca.name[l]} / ${cb.name[l]} — member of (P463)`, url: ctx.wikidata?.url ?? 'https://www.wikidata.org', date: ctx.fetchedAt?.slice(0, 10), kind: 'data' }); lines.push(`[${srcs.length}] (data) Organisations in common: ${ctx.sharedOrganizations.map((o) => o.name).join('; ')}`); }
    for (const r of coStories(a, b, PERIODS.month).slice(0, 40)) {
      for (const art of qArticles.all(r.id).slice(0, 3)) {
        srcs.push({ publisher: sources.get(art.source_id)?.name ?? art.source_id, title: art.title, url: art.url, date: art.published_at.slice(0, 10), kind: art.claim_type });
        lines.push(`[${srcs.length}] (${art.claim_type}, ${art.category}, ${art.published_at.slice(0, 10)}) ${art.title} — ${art.excerpt ?? ''}`);
      }
    }
    if (srcs.length < 2) throw fail(422, 'insufficient_sources');
    const body = await llm.relationAnalysis({ a: a.name[l], b: b.name[l], lang: l, dossier: lines.join('\n'), sources: srcs });
    db.prepare('INSERT OR REPLACE INTO relation_analyses (pair, lang, body, sources, origin, status, created_at) VALUES (?,?,?,?,?,?,?)').run(key, l, JSON.stringify(body), JSON.stringify(srcs), 'automatic', 'unreviewed', new Date().toISOString());
    res.json({ reused: false });
  }));

  // ---- Rédaction (validation éditoriale) ---------------------------------
  const admin = express.Router();
  admin.use((req, res, next) => {
    if (!config.adminToken) return next(fail(503, 'editorial_api_disabled'));
    if (req.get('authorization') !== `Bearer ${config.adminToken}`) return next(fail(401, 'unauthorized'));
    next();
  });
  admin.post('/collect', wrap(async (req, res) => res.json(await collector.runOnce())));
  admin.post('/stories/:id/review', (req, res) => {
    const { status, noteFr = null, noteEn = null, importance = null } = req.body ?? {};
    if (!['validated', 'disputed', 'corrected', 'auto'].includes(status)) throw fail(400, 'invalid_status');
    if (importance && !['major', 'important', 'notable'].includes(importance)) throw fail(400, 'invalid_importance');
    if (status === 'corrected' && !(noteFr && noteEn)) throw fail(400, 'correction_note_required');
    const r = db.prepare('UPDATE stories SET review_status=?, review_note_fr=?, review_note_en=?, importance_override=?, reviewed_at=? WHERE id=?').run(status, noteFr, noteEn, importance, new Date().toISOString(), Number(req.params.id));
    if (!r.changes) throw fail(404, 'story_not_found');
    res.json({ ok: true });
  });
  admin.put('/relations', (req, res) => {
    const { a, b, lang: l, body, sources: srcs, status = 'published' } = req.body ?? {};
    terr(a); terr(b);
    if (!LANGS.includes(l) || !body || !Array.isArray(srcs) || srcs.length < 2 || srcs.some((s) => !s.url || !s.title)) throw fail(400, 'analysis_requires_two_linked_sources');
    db.prepare('INSERT OR REPLACE INTO relation_analyses (pair, lang, body, sources, origin, status, created_at) VALUES (?,?,?,?,?,?,?)').run(geo.pairKey(a, b), l, JSON.stringify(body), JSON.stringify(srcs), 'editorial', status, new Date().toISOString());
    res.json({ ok: true });
  });
  api.use('/admin', admin);

  api.use((req, res) => res.status(404).json({ error: 'not_found' }));
  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    const status = err.status ?? 500;
    if (status >= 500 && status !== 503) console.error(err);
    res.status(status).json({ error: err.code ?? (status === 503 ? err.message : 'internal_error') });
  });
  return api;
}
