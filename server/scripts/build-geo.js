// Construit les données géographiques de la plateforme à partir de jeux de données ouverts
// distribués via npm (aucune donnée saisie à la main, hormis les exonymes français de villes) :
//   - world-atlas (Natural Earth, domaine public)  → contours des pays
//   - world-countries (mledoze/countries, ODbL)    → fiches pays (capitale, langues, frontières…)
//   - country-state-city (ODbL)                    → régions / subdivisions (points)
//   - all-the-cities (GeoNames, CC BY 4.0)         → villes et populations
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { feature } from 'topojson-client';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '../data/geo');
mkdirSync(out, { recursive: true });

const countriesRaw = require('world-countries');
const atlas = require('world-atlas/countries-50m.json');
const { State } = require('country-state-city');
const allCities = require('all-the-cities');
const cityAliases = JSON.parse(readFileSync(path.join(here, '../src/geo/city-aliases.json'), 'utf8'));

const CONTINENTS = {
  africa: { fr: 'Afrique', en: 'Africa', center: [20, 2], zoom: 2.6 },
  europe: { fr: 'Europe', en: 'Europe', center: [14, 52], zoom: 3 },
  asia: { fr: 'Asie', en: 'Asia', center: [90, 34], zoom: 2.3 },
  'north-america': { fr: 'Amérique du Nord', en: 'North America', center: [-98, 42], zoom: 2.3 },
  'south-america': { fr: 'Amérique du Sud', en: 'South America', center: [-60, -18], zoom: 2.6 },
  oceania: { fr: 'Océanie', en: 'Oceania', center: [145, -22], zoom: 2.6 },
  antarctica: { fr: 'Antarctique', en: 'Antarctica', center: [0, -80], zoom: 1.8 },
};
const continentOf = (c) => {
  if (c.region === 'Americas') return c.subregion === 'South America' ? 'south-america' : 'north-america';
  if (c.region === 'Antarctic') return 'antarctica';
  return c.region.toLowerCase();
};

const territories = [];
for (const [id, k] of Object.entries(CONTINENTS)) {
  territories.push({ id: `k:${id}`, type: 'continent', name: { fr: k.fr, en: k.en }, lon: k.center[0], lat: k.center[1], zoom: k.zoom });
}

const byCcn3 = new Map();
const byName = new Map();
const countries = {};
for (const c of countriesRaw) {
  const id = `c:${c.cca2}`;
  const t = {
    id, type: 'country', iso2: c.cca2, iso3: c.cca3,
    name: { fr: c.translations?.fra?.common ?? c.name.common, en: c.name.common },
    officialName: { fr: c.translations?.fra?.official ?? c.name.official, en: c.name.official },
    continent: `k:${continentOf(c)}`,
    subregion: c.subregion || null,
    lat: c.latlng?.[0] ?? null, lon: c.latlng?.[1] ?? null,
    capital: c.capital ?? [], area: c.area > 0 ? c.area : null,
    languages: Object.keys(c.languages ?? {}), currencies: Object.keys(c.currencies ?? {}),
    borders: [], landlocked: !!c.landlocked, unMember: !!c.unMember, independent: c.independent ?? null,
    flag: c.flag ?? null,
    demonyms: { fr: [c.demonyms?.fra?.m, c.demonyms?.fra?.f].filter(Boolean), en: [c.demonyms?.eng?.m, c.demonyms?.eng?.f].filter(Boolean) },
  };
  countries[c.cca3] = t;
  if (c.ccn3) byCcn3.set(c.ccn3, t);
  byName.set(c.name.common, t);
  territories.push(t);
}
for (const c of countriesRaw) countries[c.cca3].borders = (c.borders ?? []).map((b) => countries[b]?.id).filter(Boolean);

// Contours
const fc = feature(atlas, atlas.objects.countries);
let unmatched = [];
for (const f of fc.features) {
  const t = byCcn3.get(String(f.id ?? '').padStart(3, '0')) ?? byName.get(f.properties.name);
  if (!t) unmatched.push(f.properties.name);
  f.properties = t
    ? { tid: t.id, name_fr: t.name.fr, name_en: t.name.en, continent: t.continent }
    : { tid: null, name_fr: f.properties.name, name_en: f.properties.name, continent: null };
  delete f.id;
}
// Antiméridien : les anneaux qui franchissent ±180° sont « déroulés » (longitudes continues) afin
// d'éviter les traits parasites traversant la carte ; l'anneau polaire de l'Antarctique est refermé au pôle.
function unwrapRing(ring) {
  let shift = 0;
  const out = [ring[0].slice()];
  for (let i = 1; i < ring.length; i++) {
    const d = ring[i][0] + shift - out[i - 1][0];
    if (d > 180) shift -= 360; else if (d < -180) shift += 360;
    out.push([ring[i][0] + shift, ring[i][1]]);
  }
  const first = out[0], last = out[out.length - 1];
  if (Math.abs(last[0] - first[0]) > 180) {
    const pole = first[1] < 0 ? -90 : 90;
    out.push([last[0], pole], [first[0], pole], first.slice());
  }
  return out;
}
for (const f of fc.features) {
  const g = f.geometry;
  if (!g) continue;
  if (g.type === 'Polygon') g.coordinates = g.coordinates.map(unwrapRing);
  else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map((poly) => poly.map(unwrapRing));
}
writeFileSync(path.join(out, 'countries.geojson'), JSON.stringify(fc));

// Régions (subdivisions de premier niveau, représentées par un point)
let nRegions = 0;
for (const c of countriesRaw) {
  for (const s of State.getStatesOfCountry(c.cca2)) {
    const lat = Number(s.latitude), lon = Number(s.longitude);
    if (!s.name || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;
    territories.push({ id: `r:${c.cca2}-${s.isoCode}`, type: 'region', name: { fr: s.name, en: s.name }, country: `c:${c.cca2}`, continent: countries[c.cca3].continent, lat, lon, isoCode: `${c.cca2}-${s.isoCode}` });
    nRegions++;
  }
}

// Villes : ≥ 100 000 habitants + capitales
const capitalSet = new Set(countriesRaw.flatMap((c) => (c.capital ?? []).map((n) => `${n}|${c.cca2}`)));
const iso2 = new Map(countriesRaw.map((c) => [c.cca2, countries[c.cca3]]));
let nCities = 0;
const seenCapital = new Set();
for (const c of allCities.slice().sort((a, b) => b.population - a.population)) {
  const key = `${c.name}|${c.country}`;
  const isCapital = capitalSet.has(key) && !seenCapital.has(key) && /^PPLC/.test(c.featureCode);
  if (c.population < 100000 && !isCapital) continue;
  const parent = iso2.get(c.country);
  if (!parent) continue;
  if (isCapital) seenCapital.add(key);
  const fr = cityAliases[key];
  territories.push({ id: `v:${c.cityId}`, type: 'city', name: { fr: fr ?? c.name, en: c.name }, country: parent.id, continent: parent.continent, lat: c.loc.coordinates[1], lon: c.loc.coordinates[0], population: c.population, capital: isCapital, geonameId: c.cityId });
  nCities++;
}

writeFileSync(path.join(out, 'territories.json'), JSON.stringify(territories));

// Index de recherche compact : [id, type, nom_fr, nom_en, lon, lat, pays, population]
const r4 = (n) => (n == null ? null : Math.round(n * 1e4) / 1e4);
const index = territories.map((t) => [t.id, t.type[0] === 'c' && t.type === 'city' ? 'v' : t.type === 'continent' ? 'k' : t.type[0], t.name.fr, t.name.en, r4(t.lon), r4(t.lat), t.country ?? null, t.population ?? null, t.capital ? 1 : 0]);
writeFileSync(path.join(out, 'search-index.json'), JSON.stringify(index));

console.log(`pays: ${countriesRaw.length}, régions: ${nRegions}, villes: ${nCities}, contours sans fiche: ${unmatched.join(', ') || '—'}`);
