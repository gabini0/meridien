import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { qs, useApi, type Period, type Status } from './api';
import { Gazetteer, type Place } from './geo';
import { I18n, fmtDateTime, makeT, useI18n, type Key, type Lang } from './i18n';
import MapView, { type Activity } from './MapView';
import { RelationPanel, TerritoryPanel } from './Panels';
import { CategoryFilter, PeriodTabs, StoryFeed } from './Stories';

type Route = { view: 'home' | 'map' | 'sources'; a: string | null; b: string | null };
function parseHash(): Route {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const p = new URLSearchParams(query);
  const view = path.startsWith('/map') ? 'map' : path.startsWith('/sources') ? 'sources' : 'home';
  return { view, a: p.get('a'), b: p.get('b') };
}
const mapHash = (a: string | null, b: string | null) => `#/map${a ? qs({ a, b }) : ''}`;
const stored = <T extends string>(k: string, allowed: readonly T[], fallback: T): T => {
  try { const v = localStorage.getItem(k) as T | null; return v && allowed.includes(v) ? v : fallback; } catch { return fallback; }
};

function Search({ gaz, onPick }: { gaz: Gazetteer | null; onPick: (id: string) => void }) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState(0);
  const results = useMemo(() => (gaz ? gaz.search(q) : []), [gaz, q]);
  const choose = (p: Place) => { onPick(p.id); setQ(''); setOpen(false); };
  return (
    <div className="search" role="search">
      <input type="search" value={q} placeholder={t('search.placeholder')} aria-label={t('search.placeholder')} autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); setCur(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setCur((c) => Math.min(c + 1, results.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCur((c) => Math.max(c - 1, 0)); }
          else if (e.key === 'Enter' && results[cur]) choose(results[cur]);
          else if (e.key === 'Escape') setOpen(false);
        }} />
      {open && q.trim().length >= 2 && (
        <ul className="results" role="listbox">
          {results.length === 0 && <li className="none">{t('search.none')}</li>}
          {results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === cur} className={i === cur ? 'cur' : ''} onMouseDown={(e) => { e.preventDefault(); choose(p); }}>
              <span>{p[lang]}</span>
              <small>{t(`type.${p.type === 'city' && p.capital ? 'capital' : p.type}` as Key)}{p.country && gaz ? ` · ${gaz.name(p.country, lang)}` : ''}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Sources({ status }: { status: Status | null }) {
  const { t, lang } = useI18n();
  const src = useApi<any[]>('/sources');
  return (
    <main className="page">
      <h1>{t('src.title')}</h1>
      <section>
        <h2>{t('src.status')}</h2>
        {status && (
          <div className="stats">
            <div><b>{status.lastSuccessfulCollection ? fmtDateTime(status.lastSuccessfulCollection, lang) : t('src.never')}</b><span>{t('src.last')}</span></div>
            <div><b>{status.feeds.reachable}/{status.feeds.total}</b><span>{t('src.feeds')}</span></div>
            <div><b>{status.articles}</b><span>{t('src.articles')}</span></div>
            <div><b>{status.stories}</b><span>{t('src.stories')}</span></div>
          </div>
        )}
        {status && <p className="muted">{t('src.features', { t: t(status.features.translation ? 'src.on' : 'src.off'), e: t(status.features.editorialReview ? 'src.on' : 'src.off') })}</p>}
      </section>
      <section>
        <h2>{t('src.method')}</h2>
        <ol className="method">{(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'] as const).map((k) => <li key={k}>{t(`src.${k}` as Key)}</li>)}</ol>
      </section>
      <section>
        <h2>{t('src.list')}</h2>
        {src.loading && <p className="muted">{t('loading')}</p>}
        {src.error && <p className="muted">{t('error.load')} <button className="link" onClick={src.reload}>{t('error.retry')}</button></p>}
        <ul className="sources">
          {src.data?.map((s) => (
            <li key={s.id}>
              <a href={s.homepage} target="_blank" rel="noopener noreferrer"><b>{s.name}</b></a>{s.primary && <span className="badge cat">{t('story.primary')}</span>}
              {s.feeds.map((f: any) => {
                const st = f.error ? 'ko' : f.lastSuccess ? 'ok' : 'pending';
                return (
                  <p key={f.url} className="feedline">
                    <span className={`dot ${st}`} /> {t(`src.${st}` as Key)} · {f.lang.toUpperCase()}
                    {f.lastSuccess && <> · {t('src.lastOk')} : {fmtDateTime(f.lastSuccess, lang)}</>}
                    {f.error && <> · {t('src.error')} : <code>{f.error}</code></>}
                  </p>
                );
              })}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => stored('lang', ['fr', 'en'] as const, navigator.language?.startsWith('fr') ? 'fr' : 'en'));
  const [route, setRoute] = useState<Route>(parseHash);
  const [period, setPeriod] = useState<Period>(() => stored('period', ['today', 'week', 'month'] as const, 'week'));
  const [category, setCategory] = useState('');
  const [linking, setLinking] = useState(false);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [gaz, setGaz] = useState<Gazetteer | null>(null);
  const [geoError, setGeoError] = useState(false);
  const [wide, setWide] = useState(() => window.innerWidth >= 900);
  const t = useMemo(() => makeT(lang), [lang]);
  const status = useApi<Status>('/status');
  const activity = useApi<Activity[]>(`/map/activity${qs({ period, category })}`);
  const n = useRef(0);

  useEffect(() => { const h = () => setRoute(parseHash()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  useEffect(() => { const h = () => setWide(window.innerWidth >= 900); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, []);
  useEffect(() => { document.documentElement.lang = lang; document.title = `Méridien — ${t('nav.tagline')}`; try { localStorage.setItem('lang', lang); } catch { /* stockage indisponible */ } }, [lang, t]);
  useEffect(() => { try { localStorage.setItem('period', period); } catch { /* idem */ } }, [period]);
  const loadGeo = useCallback(() => {
    setGeoError(false);
    fetch('/api/geo/search-index.json').then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((raw) => setGaz(new Gazetteer(raw))).catch(() => setGeoError(true));
  }, []);
  useEffect(loadGeo, [loadGeo]);

  const nav = (hash: string) => { location.hash = hash; };
  const fly = (id: string) => setFocus({ id, n: ++n.current });

  /** Sélection d'un territoire (carte, recherche, liens) ; en mode liaison, complète la paire. */
  const pick = useCallback((id: string) => {
    const r = parseHash();
    if (linking && r.a && r.a !== id) { setLinking(false); nav(mapHash(r.a, id)); fly(`${r.a}~${id}`); return; }
    if (linking && !r.a) { nav(mapHash(id, null)); fly(id); return; }
    nav(mapHash(id, null)); fly(id);
  }, [linking]); // eslint-disable-line react-hooks/exhaustive-deps

  // À l'ouverture d'un lien profond, centrer la carte sur la sélection.
  useEffect(() => { if (gaz && route.a) fly(route.b ? `${route.a}~${route.b}` : route.a); }, [gaz]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasPanel = route.view === 'map' && !!route.a;
  const continents = gaz?.list.filter((p) => p.type === 'continent' && p.id !== 'k:antarctica') ?? [];

  return (
    <I18n.Provider value={{ lang, t }}>
      <div className={`app view-${route.view}`}>
        <header className="top">
          <a className="brand" href="#/" aria-label="Méridien"><span className="logo" aria-hidden="true" />Méridien</a>
          <nav aria-label="Navigation">
            <a href="#/" className={route.view === 'home' ? 'on' : ''}>{t('nav.home')}</a>
            <a href={mapHash(route.a, route.b)} className={route.view === 'map' ? 'on' : ''}>{t('nav.map')}</a>
            <a href="#/sources" className={route.view === 'sources' ? 'on' : ''}>{t('nav.sources')}</a>
          </nav>
          <Search gaz={gaz} onPick={pick} />
          <div className="lang" role="group" aria-label={t('lang.switch')}>
            {(['fr', 'en'] as Lang[]).map((l) => <button key={l} className={lang === l ? 'on' : ''} aria-pressed={lang === l} onClick={() => setLang(l)}>{l.toUpperCase()}</button>)}
          </div>
        </header>

        {route.view === 'home' && (
          <main className="home">
            <section className="hero">
              <p className="kicker">{t('nav.tagline')}</p>
              <h1>{t('home.title')}</h1>
              <p className="lead">{t('home.lead')}</p>
              <a className="btn primary" href="#/map">{t('home.cta')} →</a>
            </section>
            <div className="filters sticky">
              <PeriodTabs value={period} onChange={setPeriod} />
              <CategoryFilter value={category} onChange={setCategory} categories={status.data?.categories ?? []} />
            </div>
            <StoryFeed period={period} category={category} status={status.data} hero onLocate={pick} onNav={nav} />
          </main>
        )}

        {route.view === 'sources' && <Sources status={status.data} />}

        {route.view === 'map' && (
          <main className={`mapview${hasPanel ? ' with-panel' : ''}`}>
            {geoError && <div className="empty overlay"><p>{t('error.load')}</p><button className="btn" onClick={loadGeo}>{t('error.retry')}</button></div>}
            {gaz && <MapView gaz={gaz} a={route.a} b={route.b} activity={activity.data ?? []} focus={focus} onPick={pick} padRight={hasPanel && wide ? 440 : 0} padBottom={hasPanel && !wide ? Math.round(window.innerHeight * 0.55) : 0} />}
            <div className="map-tools">
              <div className="chips cont">
                {continents.map((c) => <button key={c.id} className={route.a === c.id && !route.b ? 'on' : ''} onClick={() => pick(c.id)}>{c[lang]}</button>)}
              </div>
              <div className="row2">
                <PeriodTabs value={period} onChange={setPeriod} />
                <button className={`btn sm${linking ? ' on' : ''}`} aria-pressed={linking} onClick={() => setLinking(!linking)}>⤳ {linking ? t('map.cancel') : t('map.link')}</button>
              </div>
              {linking && <p className="hint" role="status">{route.a && gaz ? `${gaz.name(route.a, lang)} → ${t('map.linkHint')}` : t('map.linkHint0')}</p>}
            </div>
            <p className="legend"><span className="pulse" /> {t('map.activity')}</p>
            {route.a && route.b && <RelationPanel a={route.a} b={route.b} status={status.data} onPick={pick} onClose={() => nav(mapHash(route.a, null))} />}
            {route.a && !route.b && (
              <TerritoryPanel key={route.a} id={route.a} period={period} setPeriod={setPeriod} category={category} setCategory={setCategory} status={status.data}
                onPick={pick} onLink={() => setLinking(true)} onClose={() => nav('#/map')} onNav={nav} />
            )}
          </main>
        )}
      </div>
    </I18n.Provider>
  );
}
