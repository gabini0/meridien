// Mode « instantané » : l'interface fonctionne sans serveur, à partir de fichiers statiques exportés
// (server/scripts/export-snapshot.js). Reproduit côté navigateur la logique de lecture de l'API.
import type { Lang } from './i18n';

export const SNAPSHOT = !!import.meta.env.VITE_SNAPSHOT;
export const geoUrl = (file: string) => (SNAPSHOT ? `data/${file}` : `/api/geo/${file}`);

const PERIODS: Record<string, number> = { today: 24, week: 168, month: 720 };
const RANK: Record<string, number> = { major: 100, important: 50, notable: 10 };
let cache: Promise<{ snap: any; terr: Map<string, any>; list: any[] }> | null = null;
const load = () => (cache ??= Promise.all([fetch('data/snapshot.json').then((r) => r.json()), fetch('data/territories.json').then((r) => r.json())])
  .then(([snap, list]) => ({ snap, list, terr: new Map<string, any>(list.map((t: any) => [t.id, t])) })));
export const snapshotDate = () => load().then((d) => d.snap.generatedAt as string);

const fail = (status: number, code: string) => Object.assign(new Error(code), { status, code });

export async function snapApi(pathAndQuery: string, init?: RequestInit): Promise<any> {
  const { snap, terr, list } = await load();
  const url = new URL(pathAndQuery, 'http://x');
  const q = url.searchParams, path = url.pathname;
  const lang = (q.get('lang') === 'en' ? 'en' : 'fr') as Lang;
  if (init?.method && init.method !== 'GET') throw fail(503, 'snapshot_read_only');
  const now = new Date(snap.generatedAt).getTime();
  const since = new Date(now - (PERIODS[q.get('period') ?? 'week'] ?? 168) * 36e5).toISOString();
  const brief = (t: any) => ({ id: t.id, type: t.type, name: t.name[lang], lon: t.lon, lat: t.lat, country: t.country ?? null });
  const need = (id: string | null) => { const t = id ? terr.get(id) : null; if (!t) throw fail(404, 'territory_not_found'); return t; };
  const scope = (t: any): string[] => (t.type === 'continent' ? list.filter((x: any) => x.type === 'country' && x.continent === t.id).map((x: any) => x.id) : [t.id]);
  const touches = (s: any, ids: string[]) => s.territories.some((x: any) => ids.includes(x.id));
  const stories: any[] = snap.stories[lang];

  if (path === '/status') return { ...snap.status, features: { translation: false, relationAnalysis: false, editorialReview: false } };
  if (path === '/sources') return snap.sources;
  if (path === '/stories') {
    let rows = stories.filter((s) => s.lastSeen >= since);
    if (q.get('category')) rows = rows.filter((s) => s.category === q.get('category'));
    for (const id of (q.get('territory') ?? '').split(',').filter(Boolean)) { const ids = scope(need(id)); rows = rows.filter((s) => touches(s, ids)); }
    const key = (s: any) => (s.importance.setBy === 'editorial' ? RANK[s.importance.level] : s.importance.score);
    rows = [...rows].sort((a, b) => key(b) - key(a) || (a.lastSeen < b.lastSeen ? 1 : -1));
    const limit = Math.min(Number(q.get('limit')) || 20, 50), offset = Number(q.get('offset')) || 0;
    return { total: rows.length, hasMore: rows.length > offset + limit, items: rows.slice(offset, offset + limit) };
  }
  let m = path.match(/^\/stories\/(\d+)$/);
  if (m) { const s = stories.find((x) => x.id === Number(m![1])); if (!s) throw fail(404, 'story_not_found'); return s; }
  if (path === '/map/activity') {
    const acc = new Map<string, { id: string; stories: number; top: number }>();
    for (const s of stories) {
      if (s.lastSeen < since || (q.get('category') && s.category !== q.get('category'))) continue;
      for (const t of s.territories) if (t.type === 'country') { const a = acc.get(t.id) ?? { id: t.id, stories: 0, top: 0 }; a.stories++; a.top = Math.max(a.top, s.importance.score); acc.set(t.id, a); }
    }
    return [...acc.values()].map((a) => ({ id: a.id, stories: a.stories, topLevel: a.top >= 70 ? 'major' : a.top >= 40 ? 'important' : 'notable' }));
  }
  m = path.match(/^\/territories\/([^/]+)\/context$/);
  if (m) return snap.context[`${decodeURIComponent(m[1])}|${lang}`] ?? { available: false, reason: 'snapshot' };
  m = path.match(/^\/territories\/([^/]+)$/);
  if (m) {
    const t = need(decodeURIComponent(m[1]));
    const parent = t.country ? terr.get(t.country) : null, continent = t.continent ? terr.get(t.continent) : null;
    return {
      ...brief(t), names: t.name, officialName: t.officialName?.[lang] ?? null, parent: parent ? brief(parent) : null, continent: continent ? brief(continent) : null, subregion: t.subregion ?? null,
      facts: t.type === 'country' ? { iso2: t.iso2, iso3: t.iso3, capital: t.capital, area: t.area, languages: t.languages, currencies: t.currencies, landlocked: t.landlocked, unMember: t.unMember, flag: t.flag, borders: t.borders.map((b: string) => brief(terr.get(b))) }
        : t.type === 'city' ? { population: t.population, capital: !!t.capital } : t.type === 'region' ? { isoCode: t.isoCode } : { countries: scope(t).length },
    };
  }
  if (path === '/relations') {
    const a = need(q.get('a')), b = need(q.get('b'));
    const ca = a.type === 'country' ? a : terr.get(a.country), cb = b.type === 'country' ? b : terr.get(b.country);
    const rad = (d: number) => (d * Math.PI) / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    const both = a.type === 'country' && b.type === 'country';
    const A = scope(a), B = scope(b), byCategory: Record<string, any[]> = {};
    const rows = stories.filter((s) => touches(s, A) && touches(s, B)).sort((x, y) => (x.lastSeen < y.lastSeen ? 1 : -1)).slice(0, 60);
    for (const s of rows) (byCategory[s.category] ??= []).push(s);
    const countryPair = ca && cb && ca !== cb;
    return {
      a: brief(a), b: brief(b), canGenerate: false, analysis: null, unavailable: ['bilateral_trade_figures', 'treaty_register'],
      structural: {
        sameCountry: !!ca && ca === cb && a !== b, sharedBorder: both ? a.borders.includes(b.id) : null,
        sameContinent: a.continent && a.continent === b.continent ? brief(terr.get(a.continent)) : null,
        distanceKm: a.lat != null && b.lat != null ? Math.round(2 * 6371 * Math.asin(Math.sqrt(h))) : null,
        sharedLanguages: both ? a.languages.filter((x: string) => b.languages.includes(x)) : [], sharedCurrencies: both ? a.currencies.filter((x: string) => b.currencies.includes(x)) : [],
      },
      context: countryPair ? snap.relations[`${[ca.id, cb.id].sort().join('~')}|${lang}`] ?? { available: false, reason: 'snapshot' } : { available: false, reason: 'unsupported' },
      contextScope: countryPair && (a !== ca || b !== cb) ? { a: brief(ca), b: brief(cb) } : null,
      news: { total: rows.length, windowDays: 30, byCategory },
    };
  }
  throw fail(404, 'not_found');
}
