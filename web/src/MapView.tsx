import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';

// Depuis MapLibre 6, le worker est un fichier séparé : il est servi depuis notre propre origine.
maplibregl.setWorkerUrl(workerUrl);
import { Gazetteer, greatCircle, type Place } from './geo';
import { useI18n } from './i18n';

export interface Activity { id: string; stories: number; topLevel: string }
interface Props {
  gaz: Gazetteer; a: string | null; b: string | null; activity: Activity[];
  focus: { id: string; n: number } | null; onPick: (id: string) => void; padRight: number; padBottom: number;
}

const C = { ocean: '#0b1220', land: '#1c2a40', landHi: '#2a3d5c', border: '#3b5075', sel: '#e8b04b', sel2: '#6fb7e9', city: '#d5deeb', region: '#8fa3bf' };
const CITY_TIERS: [number, number][] = [[5e6, 2.2], [2e6, 3.2], [8e5, 4.2], [3e5, 5.2], [0, 6.2]];
const cityTier = (p: Place) => (p.capital ? Math.min(3.4, CITY_TIERS.find(([min]) => (p.pop ?? 0) >= min)![1]) : CITY_TIERS.find(([min]) => (p.pop ?? 0) >= min)![1]);
const zoomFor = (p: Place) => (p.type === 'city' ? 7 : p.type === 'region' ? 5.5 : 4);

export default function MapView({ gaz, a, b, activity, focus, onPick, padRight, padBottom }: Props) {
  const { lang, t } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const ready = useRef(false);
  const live = useRef({ lang, a, b, onPick, activity });
  live.current = { lang, a, b, onPick, activity };
  const prevSel = useRef<string[]>([]);

  function drawLabels() {
    const m = map.current, box = labels.current;
    if (!m || !box) return;
    const z = m.getZoom(), { lang, a, b } = live.current, w = box.clientWidth, h = box.clientHeight;
    const act = new Set(live.current.activity.map((x) => x.id));
    const taken: [number, number, number, number][] = [];
    const html: string[] = [];
    const place = (p: Place, cls: string, force = false) => {
      if (Math.abs(p.lat) > 84) return;
      const pt = m.project([p.lon, p.lat]);
      if (pt.x < -40 || pt.y < -10 || pt.x > w + 40 || pt.y > h + 10) return;
      const name = p[lang], bw = name.length * 6.4 + 8, r: [number, number, number, number] = [pt.x - bw / 2, pt.y - 9, pt.x + bw / 2, pt.y + 9];
      if (!force && taken.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) return;
      taken.push(r);
      html.push(`<span class="ml ${cls}" style="transform:translate(${pt.x.toFixed(0)}px,${(pt.y + (cls.includes('pt') ? 9 : 0)).toFixed(0)}px) translate(-50%,-50%)">${name.replace(/</g, '&lt;')}</span>`);
    };
    for (const id of [a, b]) { const p = id ? gaz.byId.get(id) : null; if (p && p.type !== 'continent') place(p, `sel ${p.type === 'country' ? '' : 'pt'}`, true); }
    if (z < 2.4) for (const p of gaz.list) if (p.type === 'continent' && p.id !== 'k:antarctica') place(p, 'cont');
    if (z >= 2.4) {
      const countries = gaz.list.filter((p) => p.type === 'country' && p.id !== a && p.id !== b).sort((x, y) => Number(act.has(y.id)) - Number(act.has(x.id)));
      for (const p of countries) place(p, 'country');
    }
    if (z >= 3.2) for (const p of gaz.list) if (p.type === 'city' && cityTier(p) <= z && p.id !== a && p.id !== b) place(p, 'city pt');
    if (z >= 5.4) for (const p of gaz.list) if (p.type === 'region' && p.id !== a && p.id !== b) place(p, 'region pt');
    box.innerHTML = html.join('');
  }

  function syncSelection() {
    const m = map.current; if (!m || !ready.current) return;
    const { a, b } = live.current;
    for (const id of prevSel.current) m.setFeatureState({ source: 'countries', id }, { sel: 0 });
    prevSel.current = [];
    const pts: any[] = [];
    [a, b].forEach((id, i) => {
      const p = id ? gaz.byId.get(id) : null; if (!p) return;
      if (p.type === 'country') { m.setFeatureState({ source: 'countries', id: p.id }, { sel: i + 1 }); prevSel.current.push(p.id); }
      if (p.type !== 'continent') pts.push({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
    });
    (m.getSource('sel') as GeoJSONSource).setData({ type: 'FeatureCollection', features: pts });
    const pa = a ? gaz.byId.get(a) : null, pb = b ? gaz.byId.get(b) : null;
    (m.getSource('link') as GeoJSONSource).setData({ type: 'FeatureCollection', features: pa && pb ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: greatCircle([pa.lon, pa.lat], [pb.lon, pb.lat]) } }] : [] });
    drawLabels();
  }

  function syncActivity() {
    const m = map.current; if (!m || !ready.current) return;
    const max = Math.max(1, ...live.current.activity.map((x) => x.stories));
    (m.getSource('activity') as GeoJSONSource).setData({ type: 'FeatureCollection', features: live.current.activity.flatMap((x) => {
      const p = gaz.byId.get(x.id);
      return p ? [{ type: 'Feature' as const, properties: { id: x.id, w: Math.sqrt(x.stories / max), major: x.topLevel === 'major' ? 1 : 0 }, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] } }] : [];
    }) });
    drawLabels();
  }

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!, center: [12, 28], zoom: 1.6, minZoom: 0.8, maxZoom: 9, attributionControl: false, dragRotate: false, pitchWithRotate: false, renderWorldCopies: true,
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': C.ocean } }] },
    });
    m.touchZoomRotate.disableRotation();
    map.current = m;
    (window as any).__map = m;
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Natural Earth · GeoNames' }), 'bottom-left');
    m.on('load', () => {
      m.addSource('countries', { type: 'geojson', data: '/api/geo/countries.geojson', promoteId: 'tid', tolerance: 0.25 });
      m.addLayer({ id: 'land', type: 'fill', source: 'countries', paint: {
        'fill-color': ['case', ['==', ['feature-state', 'sel'], 1], '#6b5220', ['==', ['feature-state', 'sel'], 2], '#234e6d', ['boolean', ['feature-state', 'hover'], false], C.landHi, C.land] } });
      m.addLayer({ id: 'borders', type: 'line', source: 'countries', paint: {
        'line-color': ['case', ['==', ['feature-state', 'sel'], 1], C.sel, ['==', ['feature-state', 'sel'], 2], C.sel2, C.border],
        'line-width': ['case', ['>', ['coalesce', ['feature-state', 'sel'], 0], 0], 1.8, 0.6] } });
      m.addSource('activity', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'activity', type: 'circle', source: 'activity', paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'w'], 0, 4, 1, 20], 'circle-color': C.sel, 'circle-opacity': 0.28,
        'circle-stroke-color': C.sel, 'circle-stroke-width': ['case', ['==', ['get', 'major'], 1], 1.6, 0.6], 'circle-stroke-opacity': 0.9 } });
      const pts = (type: string, minTier?: number, maxTier?: number) => ({ type: 'FeatureCollection' as const, features: gaz.list.filter((p) => p.type === type && (minTier == null || (cityTier(p) > minTier && cityTier(p) <= maxTier!))).map((p) => ({ type: 'Feature' as const, properties: { id: p.id, cap: p.capital ? 1 : 0 }, geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] } })) });
      m.addSource('regions', { type: 'geojson', data: pts('region') });
      m.addLayer({ id: 'regions', type: 'circle', source: 'regions', minzoom: 5, paint: { 'circle-radius': 3, 'circle-color': C.ocean, 'circle-stroke-color': C.region, 'circle-stroke-width': 1.2 } });
      let lo = 0;
      for (const hi of [2.2, 3.2, 3.4, 4.2, 5.2, 6.2]) {
        m.addSource(`cities${hi}`, { type: 'geojson', data: pts('city', lo, hi) });
        m.addLayer({ id: `cities${hi}`, type: 'circle', source: `cities${hi}`, minzoom: hi, paint: { 'circle-radius': ['case', ['==', ['get', 'cap'], 1], 4, 3], 'circle-color': C.city, 'circle-stroke-color': C.ocean, 'circle-stroke-width': 1 } });
        lo = hi;
      }
      m.addSource('link', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'link', type: 'line', source: 'link', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#f4f1e8', 'line-width': 2, 'line-dasharray': [0.5, 2] } });
      m.addSource('sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'sel', type: 'circle', source: 'sel', paint: { 'circle-radius': 7, 'circle-color': ['case', ['==', ['get', 'i'], 0], C.sel, C.sel2], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });

      const pointLayers = ['cities2.2', 'cities3.2', 'cities3.4', 'cities4.2', 'cities5.2', 'cities6.2', 'regions'];
      let hover: string | null = null;
      m.on('mousemove', (e) => {
        const p = m.queryRenderedFeatures([[e.point.x - 5, e.point.y - 5], [e.point.x + 5, e.point.y + 5]], { layers: pointLayers })[0];
        const f = p ? null : m.queryRenderedFeatures(e.point, { layers: ['land'] })[0];
        const id = (f?.properties?.tid as string) || null;
        if (id !== hover) {
          if (hover) m.setFeatureState({ source: 'countries', id: hover }, { hover: false });
          if (id) m.setFeatureState({ source: 'countries', id }, { hover: true });
          hover = id;
        }
        m.getCanvas().style.cursor = p || id ? 'pointer' : '';
      });
      m.on('click', (e) => {
        const p = m.queryRenderedFeatures([[e.point.x - 7, e.point.y - 7], [e.point.x + 7, e.point.y + 7]], { layers: pointLayers })[0];
        const id = (p?.properties?.id as string) ?? (m.queryRenderedFeatures(e.point, { layers: ['land'] })[0]?.properties?.tid as string);
        if (id) live.current.onPick(id);
      });
      ready.current = true;
      syncSelection(); syncActivity();
    });
    let raf = 0;
    m.on('move', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawLabels); });
    m.on('idle', drawLabels);
    const ro = new ResizeObserver(() => { m.resize(); drawLabels(); });
    ro.observe(el.current!);
    return () => { ro.disconnect(); m.remove(); map.current = null; ready.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(syncSelection, [a, b]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(syncActivity, [activity]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(drawLabels, [lang]);     // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current; if (!m || !focus) return;
    const ids = focus.id.split('~'), pa = gaz.byId.get(ids[0]), pb = ids[1] ? gaz.byId.get(ids[1]) : null;
    if (!pa) return;
    const padding = { top: 110, bottom: 50 + padBottom, left: 40, right: 40 + padRight };
    if (pb) {
      const line = greatCircle([pa.lon, pa.lat], [pb.lon, pb.lat], 16);
      const bounds = line.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(line[0], line[0]));
      m.fitBounds(bounds, { padding, maxZoom: 5, duration: 900 });
    } else if (pa.type === 'continent') m.flyTo({ center: [pa.lon, pa.lat], zoom: pa.id === 'k:europe' ? 3 : 2.4, padding, duration: 900 });
    else m.flyTo({ center: [pa.lon, pa.lat], zoom: Math.max(m.getZoom(), zoomFor(pa)), padding, duration: 900 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" role="application" aria-label={t('nav.map')} />
      <div ref={labels} className="map-labels" aria-hidden="true" />
      <div className="map-zoom">
        <button onClick={() => map.current?.zoomIn()} aria-label={t('map.zoomIn')} title={t('map.zoomIn')}>+</button>
        <button onClick={() => map.current?.zoomOut()} aria-label={t('map.zoomOut')} title={t('map.zoomOut')}>−</button>
        <button onClick={() => map.current?.flyTo({ center: [12, 28], zoom: 1.6 })} aria-label={t('map.reset')} title={t('map.reset')}>◎</button>
      </div>
    </div>
  );
}
