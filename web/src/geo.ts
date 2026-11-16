import type { Lang } from './i18n';

export type TType = 'continent' | 'country' | 'region' | 'city';
export interface Place { id: string; type: TType; fr: string; en: string; lon: number; lat: number; country: string | null; pop: number | null; capital: boolean; key: string }
const TYPES: Record<string, TType> = { k: 'continent', c: 'country', r: 'region', v: 'city' };
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export class Gazetteer {
  list: Place[];
  byId = new Map<string, Place>();
  constructor(raw: any[][]) {
    this.list = raw.map((r) => ({ id: r[0], type: TYPES[r[1]], fr: r[2], en: r[3], lon: r[4], lat: r[5], country: r[6], pop: r[7], capital: !!r[8], key: norm(`${r[2]} ${r[3]}`) }));
    for (const p of this.list) this.byId.set(p.id, p);
  }
  name(id: string | null, lang: Lang) { const p = id ? this.byId.get(id) : null; return p ? p[lang] : ''; }
  search(q: string, limit = 8): Place[] {
    const n = norm(q.trim());
    if (n.length < 2) return [];
    const rank = { continent: 0, country: 1, city: 2, region: 3 };
    const scored: [number, Place][] = [];
    for (const p of this.list) {
      const a = norm(p.fr), b = norm(p.en);
      let s = -1;
      if (a === n || b === n) s = 0; else if (a.startsWith(n) || b.startsWith(n)) s = 1; else if (p.key.includes(' ' + n) ) s = 2; else if (n.length >= 4 && p.key.includes(n)) s = 3;
      if (s < 0) continue;
      scored.push([s * 10 + rank[p.type] - Math.min((p.pop ?? 0) / 1e7, 0.9), p]);
    }
    return scored.sort((x, y) => x[0] - y[0]).slice(0, limit).map((x) => x[1]);
  }
}

/** Arc de grand cercle entre deux points (liste de [lon, lat]). */
export function greatCircle(a: [number, number], b: [number, number], n = 64): [number, number][] {
  const rad = Math.PI / 180, [l1, p1, l2, p2] = [a[0] * rad, a[1] * rad, b[0] * rad, b[1] * rad];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (!d) return [a, b];
  const out: [number, number][] = [];
  let prev: number | null = null, shift = 0;
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2), y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2), z = A * Math.sin(p1) + B * Math.sin(p2);
    let lon = Math.atan2(y, x) / rad;
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / rad;
    if (prev != null) { if (lon + shift - prev > 180) shift -= 360; else if (lon + shift - prev < -180) shift += 360; }
    lon += shift; prev = lon;
    out.push([lon, lat]);
  }
  return out;
}
