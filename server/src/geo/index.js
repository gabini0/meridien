// Données géographiques + géo-étiquetage : repère dans un texte les pays, capitales et grandes
// villes cités. Méthode par dictionnaire (noms FR/EN, gentilés), volontairement simple et
// explicable ; ses limites (homonymes) sont documentées dans le README.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Noms trop ambigus pour être étiquetés automatiquement (prénoms, mots courants, homonymes).
const CITY_STOP = new Set(['Male', 'Victoria', 'Kingston', 'Georgetown', 'San Jose', 'Hamilton', 'Roseau', 'David', 'George', 'Nice', 'Mobile', 'Reading', 'Bath', 'Valencia', 'Santiago', 'San Juan', 'Santa Cruz', 'Cordoba', 'Leon', 'Merida', 'Union', 'Central', 'Hyderabad', 'Tripoli', 'Alexandria', 'Vienne', 'Mexico', 'Singapore', 'Singapour', 'Luxembourg', 'Monaco', 'Djibouti', 'Panama', 'Guatemala City', 'Kuwait City', 'Van', 'Bur', 'Wuhu', 'Aba', 'Of']);
const EXTRA = {
  'c:US': { names: ['United States', 'U.S.', 'USA', 'États-Unis', 'Etats-Unis', 'Washington'], cased: ['US'], adj: ['American', 'Americans', 'américain', 'américaine', 'américains', 'américaines'] },
  'c:GB': { names: ['United Kingdom', 'Britain', 'Royaume-Uni', 'Grande-Bretagne'], cased: ['UK'], adj: ['British', 'britannique', 'britanniques'] },
  'c:RU': { names: ['Russie', 'Kremlin'] }, 'c:KP': { names: ['North Korea', 'Corée du Nord'] }, 'c:KR': { names: ['South Korea', 'Corée du Sud'] },
  'c:CD': { names: ['DRC', 'RDC', 'Democratic Republic of Congo', 'République démocratique du Congo'] },
  'c:CI': { names: ['Ivory Coast', "Côte d'Ivoire"] }, 'c:CZ': { names: ['Czech Republic', 'République tchèque'] },
  'c:PS': { names: ['Gaza', 'West Bank', 'Cisjordanie', 'Palestinian territories', 'Territoires palestiniens'], adj: ['Palestinian', 'Palestinians', 'palestinien', 'palestinienne', 'palestiniens', 'palestiniennes'] },
  'c:TR': { names: ['Türkiye', 'Turkey', 'Turquie'] }, 'c:MM': { names: ['Burma', 'Birmanie'] }, 'c:AE': { names: ['UAE', 'Émirats arabes unis', 'Emirats arabes unis'] },
  'c:VA': { names: ['Vatican'] }, 'c:SY': { names: ['Syrie'] }, 'c:TW': { names: ['Taïwan'] },
};

export function loadGeo(geoDir) {
  const territories = JSON.parse(readFileSync(path.join(geoDir, 'territories.json'), 'utf8'));
  const byId = new Map(territories.map((t) => [t.id, t]));

  // motif normalisé → id de territoire
  const cased = new Map();   // sensible à la casse (noms propres)
  const uncased = new Map(); // insensible (gentilés français, écrits en minuscules)
  const add = (map, pattern, id, lower = false) => {
    if (!pattern || pattern.length < 3) return;
    const key = lower ? strip(pattern).toLowerCase() : strip(pattern);
    if (!map.has(key)) map.set(key, id);
  };
  for (const t of territories) {
    if (t.type === 'country') {
      for (const n of [t.name.en, t.name.fr]) add(cased, n, t.id);
      for (const d of t.demonyms.en) { add(cased, d, t.id); add(cased, d + 's', t.id); }
      for (const d of t.demonyms.fr) { add(uncased, d, t.id, true); add(uncased, d + 's', t.id, true); }
      const x = EXTRA[t.id];
      if (x) {
        for (const n of x.names ?? []) add(cased, n, t.id);
        for (const n of x.adj ?? []) add(uncased, n, t.id, true);
      }
    }
  }
  for (const t of territories) {
    if (t.type !== 'city' || !(t.capital || t.population >= 1_000_000)) continue;
    for (const n of new Set([t.name.en, t.name.fr])) {
      if (n.length < 4 || CITY_STOP.has(strip(n)) || cased.has(strip(n))) continue;
      add(cased, n, t.id);
    }
  }
  const shortCased = new Map();
  for (const [id, x] of Object.entries(EXTRA)) for (const n of x.cased ?? []) shortCased.set(n, id);
  // "Chad", "Jordan", "Georgia", "Turkey"… : homonymes fréquents, conservés mais uniquement en casse exacte.

  const alt = (m) => [...m.keys()].sort((a, b) => b.length - a.length).map(esc).join('|');
  const B = "(?<![\\p{L}\\p{N}])", E = "(?![\\p{L}\\p{N}])";
  const reCased = new RegExp(`${B}(${alt(cased)}|${alt(shortCased)})${E}`, 'gu');
  const reUncased = new RegExp(`${B}(${alt(uncased)})${E}`, 'giu');

  /** @returns {string[]} ids de territoires cités (les villes ajoutent aussi leur pays) */
  function tag(text) {
    if (!text) return [];
    const s = strip(text).replace(/[’`]/g, "'");
    const found = new Set();
    for (const m of s.matchAll(reCased)) found.add(cased.get(m[1]) ?? shortCased.get(m[1]));
    for (const m of s.matchAll(reUncased)) { const id = uncased.get(m[1].toLowerCase()); if (id) found.add(id); }
    for (const id of [...found]) { const t = byId.get(id); if (t?.country) found.add(t.country); }
    return [...found];
  }

  const pairKey = (a, b) => [a, b].sort().join('~');
  return { territories, byId, tag, pairKey };
}
