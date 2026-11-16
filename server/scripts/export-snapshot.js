// Exporte un instantané statique (lecture seule) à partir d'une instance en cours d'exécution :
// sujets réels collectés, fiches de contexte déjà consultables, données géographiques.
// Usage : node scripts/export-snapshot.js [http://localhost:8787] [dossier de sortie]
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://localhost:8787';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[3] ?? path.join(here, '../../web/public-snapshot/data');
mkdirSync(out, { recursive: true });
const get = async (p) => { const r = await fetch(base + '/api' + p, { signal: AbortSignal.timeout(120000) }); if (!r.ok) throw new Error(`${p} → ${r.status}`); return r.json(); };

const snap = { generatedAt: new Date().toISOString(), status: await get('/status'), sources: await get('/sources'), stories: {}, context: {}, relations: {} };
for (const lang of ['fr', 'en']) {
  const ids = [];
  for (let offset = 0; ; offset += 50) { const r = await get(`/stories?period=month&limit=50&offset=${offset}&lang=${lang}`); ids.push(...r.items.map((s) => s.id)); if (!r.hasMore) break; }
  snap.stories[lang] = [];
  for (const id of ids) { const s = await get(`/stories/${id}?lang=${lang}`); s.image = null; snap.stories[lang].push(s); } // images des éditeurs non embarquées
}
// Contexte encyclopédique : pays les plus présents dans l'actualité, et paires de pays les plus souvent citées ensemble.
const count = new Map(), pairs = new Map();
for (const s of snap.stories.fr) {
  const cs = s.territories.filter((t) => t.type === 'country').map((t) => t.id).sort();
  for (const c of cs) count.set(c, (count.get(c) ?? 0) + 1);
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) pairs.set(`${cs[i]}~${cs[j]}`, (pairs.get(`${cs[i]}~${cs[j]}`) ?? 0) + 1);
}
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
for (const lang of ['fr', 'en']) {
  for (const id of top(count, 16)) { const c = await get(`/territories/${id}/context?lang=${lang}`); if (c.available) snap.context[`${id}|${lang}`] = c; else console.warn('contexte indisponible', id, lang, c.detail ?? c.reason); }
  for (const key of top(pairs, 8)) { const [a, b] = key.split('~'); const r = await get(`/relations?a=${a}&b=${b}&lang=${lang}`); if (r.context.available) snap.relations[`${key}|${lang}`] = r.context; else console.warn('relation indisponible', key, lang, r.context.detail ?? r.context.reason); }
}
writeFileSync(path.join(out, 'snapshot.json'), JSON.stringify(snap));
for (const f of ['countries.geojson', 'search-index.json', 'territories.json']) copyFileSync(path.join(here, '../data/geo', f), path.join(out, f));
console.log(`instantané : ${snap.stories.fr.length} sujets, ${Object.keys(snap.context).length} fiches de contexte, ${Object.keys(snap.relations).length} relations → ${out}`);
