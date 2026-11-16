// Contexte encyclopédique : Wikidata (identification, données structurées) et Wikipédia (résumés
// FR/EN sous licence CC BY-SA, toujours cités avec lien). Résultats mis en cache ; en cas
// d'indisponibilité, la fiche signale l'absence de contexte au lieu d'afficher un texte de substitution.
const TTL_MS = 7 * 864e5;

export function createContext({ db, config, fetchImpl = fetch }) {
  const get = db.prepare('SELECT value, fetched_at FROM cache WHERE key = ?');
  const put = db.prepare('INSERT OR REPLACE INTO cache (key, value, fetched_at) VALUES (?,?,?)');

  async function cachedJson(key, loader) {
    const row = get.get(key);
    if (row && Date.now() - new Date(row.fetched_at).getTime() < TTL_MS) return JSON.parse(row.value);
    try {
      const value = await loader();
      put.run(key, JSON.stringify(value), new Date().toISOString());
      return value;
    } catch (e) {
      if (row) return { ...JSON.parse(row.value), stale: true }; // on préfère une donnée ancienne signalée à une absence
      throw e;
    }
  }

  async function http(url) {
    const res = await fetchImpl(url, { headers: { 'user-agent': config.userAgent, accept: 'application/json' }, signal: AbortSignal.timeout(config.fetchTimeoutMs) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  const sparql = async (query) => (await http(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`))?.results?.bindings ?? [];

  async function summary(lang, title) {
    if (!title) return null;
    const j = await http(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    if (!j || j.type === 'disambiguation' || !j.extract) return null;
    return { title: j.title, extract: j.extract, url: j.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`, image: j.thumbnail?.source ?? null, revised: j.timestamp ?? null, lang };
  }

  const selector = (t) =>
    t.type === 'country' ? `?item wdt:P297 "${t.iso2}".`
    : t.type === 'city' ? `?item wdt:P1566 "${t.geonameId}".`
    : t.type === 'region' ? `?item wdt:P300 "${t.isoCode}".` : null;

  /** Fiche de contexte d'un territoire. */
  async function territory(t, lang) {
    const sel = selector(t);
    if (!sel) return { available: false, reason: 'unsupported' };
    try {
      return await cachedJson(`ctx:${t.id}:${lang}`, async () => {
        const rows = await sparql(`SELECT ?item ?title ?histTitle ?pop ?popDate ?hosLabel ?hogLabel WHERE {
          ${sel}
          OPTIONAL { ?art schema:about ?item; schema:isPartOf <https://${lang}.wikipedia.org/>; schema:name ?title. }
          OPTIONAL { ?item wdt:P2184 ?hist. ?hart schema:about ?hist; schema:isPartOf <https://${lang}.wikipedia.org/>; schema:name ?histTitle. }
          OPTIONAL { ?item p:P1082 ?ps. ?ps ps:P1082 ?pop; wikibase:rank wikibase:PreferredRank. OPTIONAL { ?ps pq:P585 ?popDate. } }
          OPTIONAL { ?item wdt:P35 ?hos. } OPTIONAL { ?item wdt:P6 ?hog. }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en". }
        } LIMIT 1`);
        const r = rows[0];
        if (!r) return { available: false, reason: 'not_found' };
        const qid = r.item.value.split('/').pop();
        const [overview, history] = await Promise.all([summary(lang, r.title?.value), summary(lang, r.histTitle?.value)]);
        return {
          available: true, wikidata: { id: qid, url: `https://www.wikidata.org/wiki/${qid}` },
          facts: {
            population: r.pop ? { value: Number(r.pop.value), date: r.popDate?.value?.slice(0, 10) ?? null } : null,
            headOfState: r.hosLabel?.value ?? null, headOfGovernment: r.hogLabel?.value ?? null,
          },
          overview, history, fetchedAt: new Date().toISOString(),
        };
      });
    } catch (e) {
      return { available: false, reason: 'source_unavailable', detail: String(e?.message ?? e).slice(0, 200) };
    }
  }

  /** Contexte d'une relation bilatérale entre deux pays : article dédié + organisations communes. */
  async function relation(a, b, lang) {
    if (a.type !== 'country' || b.type !== 'country') return { available: false, reason: 'unsupported' };
    const key = `rel:${[a.iso2, b.iso2].sort().join('-')}:${lang}`;
    try {
      return await cachedJson(key, async () => {
        const [rel, orgs] = await Promise.all([
          sparql(`SELECT ?rel ?title WHERE { ?a wdt:P297 "${a.iso2}". ?b wdt:P297 "${b.iso2}". ?rel wdt:P31 wd:Q15221623; wdt:P17 ?a; wdt:P17 ?b.
            OPTIONAL { ?art schema:about ?rel; schema:isPartOf <https://${lang}.wikipedia.org/>; schema:name ?title. } } LIMIT 1`),
          sparql(`SELECT DISTINCT ?org ?orgLabel WHERE { ?a wdt:P297 "${a.iso2}". ?b wdt:P297 "${b.iso2}". ?a wdt:P463 ?org. ?b wdt:P463 ?org.
            SERVICE wikibase:label { bd:serviceParam wikibase:language "${lang},en". } } LIMIT 80`),
        ]);
        const r = rel[0];
        return {
          available: true,
          wikidata: r ? { id: r.rel.value.split('/').pop(), url: r.rel.value.replace('http://', 'https://').replace('/entity/', '/wiki/') } : null,
          article: r?.title ? await summary(lang, r.title.value) : null,
          sharedOrganizations: orgs.map((o) => ({ name: o.orgLabel.value, url: o.org.value.replace('http://', 'https://').replace('/entity/', '/wiki/') })).filter((o) => !/^Q\d+$/.test(o.name)),
          fetchedAt: new Date().toISOString(),
        };
      });
    } catch (e) {
      return { available: false, reason: 'source_unavailable', detail: String(e?.message ?? e).slice(0, 200) };
    }
  }

  return { territory, relation };
}
