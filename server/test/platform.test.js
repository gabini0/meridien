import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFeed } from '../src/collector/feed-parser.js';
import { classifyCategory, classifyClaim } from '../src/editorial/classify.js';
import { importance } from '../src/editorial/cluster.js';
import { createApp } from '../src/app.js';
import { config as base } from '../src/config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (f) => readFileSync(path.join(here, 'fixtures', f), 'utf8').replaceAll('NOW_RFC', new Date().toUTCString()).replaceAll('NOW_ISO', new Date().toISOString());

test('analyse RSS et Atom, écarte les articles non traçables', () => {
  const a = parseFeed(fx('a.rss.xml'));
  assert.equal(a.length, 2);
  assert.equal(a[0].url, 'https://a.test/treaty');
  assert.equal(a[0].excerpt, 'Negotiators from France and Germany & observers attended the summit.');
  assert.equal(a[0].imageUrl, 'https://a.test/img.jpg');
  const b = parseFeed(fx('b.atom.xml'));
  assert.equal(b[0].url, 'https://b.test/traite');
  assert.throws(() => parseFeed('<html></html>'));
});

test('classement et importance', () => {
  assert.equal(classifyCategory('Ceasefire talks collapse as strikes resume'), 'conflict');
  assert.equal(classifyCategory('La banque centrale relève ses taux face à l’inflation'), 'economy');
  assert.equal(classifyClaim({ title: 'Minister says talks will continue' }), 'statement');
  assert.equal(classifyClaim({ title: 'Flood hits city', url: 'https://x.test/opinion/a' }), 'analysis');
  assert.equal(importance({ sourceGroups: 1, countries: 1, langs: 1, category: 'culture' }).level, 'notable');
  assert.equal(importance({ sourceGroups: 4, countries: 3, langs: 2, category: 'conflict' }).level, 'major');
});

test('collecte → recoupement → API, avec une source en panne', async (t) => {
  const sources = [
    { id: 'a', name: 'Fixture A', group: 'ga', homepage: 'https://a.test', feeds: [{ url: 'https://a.test/rss', lang: 'en' }] },
    { id: 'b', name: 'Fixture B', group: 'gb', homepage: 'https://b.test', feeds: [{ url: 'https://b.test/atom', lang: 'fr' }] },
    { id: 'c', name: 'Fixture C', group: 'gc', homepage: 'https://c.test', feeds: [{ url: 'https://c.test/rss', lang: 'en' }] },
  ];
  const fetchImpl = async (url) => {
    if (url.includes('a.test')) return new Response(fx('a.rss.xml'));
    if (url.includes('b.test')) return new Response(fx('b.atom.xml'));
    if (url.includes('c.test')) return new Response('down', { status: 503 });
    throw new Error('ENOTFOUND'); // Wikidata/Wikipédia injoignables dans ce test
  };
  const { app, collector } = createApp({ ...base, dbPath: ':memory:', adminToken: 'secret', anthropicApiKey: null }, { collector: { sources, fetchImpl, log: { warn() {}, info() {} } }, context: { fetchImpl } });
  const summary = await collector.runOnce();
  assert.equal(summary.ok, 2);
  assert.equal(summary.added, 3);

  const server = app.listen(0);
  t.after(() => server.close());
  const get = async (p, init) => { const r = await fetch(`http://localhost:${server.address().port}/api${p}`, init); return { status: r.status, body: await r.json() }; };

  const { body: list } = await get('/stories?period=today&lang=fr');
  assert.equal(list.total, 2);
  const top = list.items[0];
  assert.equal(top.verification.status, 'corroborated');
  assert.equal(top.verification.independentSources, 2);
  assert.equal(top.lead.lang, 'fr'); // en-tête dans la langue demandée
  assert.ok(top.territories.some((x) => x.id === 'c:FR') && top.territories.some((x) => x.id === 'c:DE'));
  assert.equal(list.items[1].verification.status, 'single_source');
  assert.equal(list.items[1].lead.claimType, 'statement');

  const { body: src } = await get('/sources');
  assert.equal(src.find((s) => s.id === 'c').feeds[0].error, 'HTTP 503');

  const { body: fr } = await get('/territories/c:FR?lang=en');
  assert.equal(fr.name, 'France');
  assert.ok(fr.facts.borders.some((b) => b.id === 'c:DE'));
  assert.equal((await get('/territories/c:FR/context')).body.available, false);
  assert.equal((await get('/territories/zz')).status, 404);

  const { body: rel } = await get('/relations?a=c:FR&b=c:DE&lang=en');
  assert.equal(rel.structural.sharedBorder, true);
  assert.equal(rel.news.total, 1);
  assert.equal(rel.context.available, false);
  assert.equal(rel.analysis, null);

  const { body: eu } = await get('/stories?period=today&territory=k:europe');
  assert.equal(eu.total, 1);
  const act = (await get('/map/activity?period=today')).body;
  assert.ok(act.some((x) => x.id === 'c:JP'));

  assert.equal((await get(`/stories/${top.id}/translate?lang=en`, { method: 'POST' })).status, 503);
  assert.equal((await get(`/admin/stories/${top.id}/review`, { method: 'POST' })).status, 401);
  const rev = await get(`/admin/stories/${top.id}/review`, { method: 'POST', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, body: JSON.stringify({ status: 'corrected', noteFr: 'Chiffre rectifié.', noteEn: 'Figure corrected.', importance: 'major' }) });
  assert.equal(rev.status, 200);
  const one = (await get(`/stories/${top.id}?lang=en`)).body;
  assert.equal(one.verification.status, 'corrected');
  assert.equal(one.verification.note, 'Figure corrected.');
  assert.equal(one.importance.level, 'major');
  assert.equal(one.articles.length, 2);
});
