import { useState } from 'react';
import { api, qs, useApi, type Brief, type Period, type Status, type Story, type Wiki } from './api';
import { displayName, fmtDate, fmtNum, useI18n, type Key } from './i18n';
import { CategoryFilter, PeriodTabs, StoryCard, StoryFeed } from './Stories';

interface Territory extends Brief { names: { fr: string; en: string }; officialName: string | null; parent: Brief | null; continent: Brief | null; subregion: string | null; facts: any }
interface Ctx { available: boolean; reason?: string; stale?: boolean; wikidata?: { url: string }; facts?: { population: { value: number; date: string | null } | null; headOfState: string | null; headOfGovernment: string | null }; overview?: Wiki | null; history?: Wiki | null }

function WikiBlock({ title, w }: { title: string; w: Wiki }) {
  const { t } = useI18n();
  return (
    <section className="wiki">
      <h4>{title}</h4>
      <p>{w.extract}</p>
      <p className="meta"><a href={w.url} target="_blank" rel="noopener noreferrer">{t('ctx.readMore')} — {w.title}</a> · {t('ctx.license')}</p>
    </section>
  );
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => <div className="row"><dt>{k}</dt><dd>{children}</dd></div>;

export function TerritoryPanel({ id, period, setPeriod, category, setCategory, status, onPick, onLink, onClose, onNav }: {
  id: string; period: Period; setPeriod: (p: Period) => void; category: string; setCategory: (c: string) => void; status: Status | null;
  onPick: (id: string) => void; onLink: () => void; onClose: () => void; onNav: (h: string) => void;
}) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<'news' | 'facts' | 'context'>('news');
  const terr = useApi<Territory>(`/territories/${id}${qs({ lang })}`);
  const ctx = useApi<Ctx>(tab !== 'news' ? `/territories/${id}/context${qs({ lang })}` : null);
  const d = terr.data, f = d?.facts;
  const typeLabel = d ? (d.type === 'city' && f?.capital ? t('type.capital') : t(`type.${d.type}` as Key)) : '';

  return (
    <aside className="panel" aria-label={d?.name}>
      <header>
        <button className="close" onClick={onClose} aria-label={t('panel.close')}>×</button>
        {terr.loading && !d && <p className="muted">{t('loading')}</p>}
        {terr.error && <p className="muted">{t('error.load')} <button className="link" onClick={terr.reload}>{t('error.retry')}</button></p>}
        {d && (<>
          <p className="kicker">{typeLabel}{d.parent && <> · <button className="link" onClick={() => onPick(d.parent!.id)}>{d.parent.name}</button></>}{d.continent && d.type !== 'continent' && <> · <button className="link" onClick={() => onPick(d.continent!.id)}>{d.continent.name}</button></>}</p>
          <h2>{f?.flag && <span className="flag">{f.flag} </span>}{d.name}</h2>
          {d.officialName && d.officialName !== d.name && <p className="muted">{d.officialName}</p>}
          <button className="btn sm" onClick={onLink}>⤳ {t('panel.linkFrom')}</button>
        </>)}
      </header>
      <div className="tabs sub" role="tablist">
        {(['news', 'facts', 'context'] as const).map((x) => <button key={x} role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`panel.${x}` as Key)}</button>)}
      </div>
      <div className="panel-body">
        {tab === 'news' && (<>
          <PeriodTabs value={period} onChange={setPeriod} />
          <CategoryFilter value={category} onChange={setCategory} categories={status?.categories ?? []} />
          <StoryFeed period={period} category={category} territory={id} status={status} limit={8} onTerritory={onPick} onNav={onNav} />
        </>)}
        {tab === 'facts' && d && (
          <dl className="facts">
            {d.type === 'country' && (<>
              <Row k={t('facts.capital')}>{f.capital.join(', ') || '—'}</Row>
              <Row k={t('facts.continent')}>{d.continent?.name}{d.subregion ? ` (${d.subregion})` : ''}</Row>
              {ctx.data?.facts?.population && <Row k={t('facts.population')}>{fmtNum(ctx.data.facts.population.value, lang)}{ctx.data.facts.population.date && <span className="muted"> ({t('facts.asOf', { d: fmtDate(ctx.data.facts.population.date, lang) })}, Wikidata)</span>}</Row>}
              {f.area && <Row k={t('facts.area')}>{fmtNum(Math.round(f.area), lang)} km²</Row>}
              {ctx.data?.facts?.headOfState && <Row k={t('facts.hos')}>{ctx.data.facts.headOfState} <span className="muted">(Wikidata)</span></Row>}
              {ctx.data?.facts?.headOfGovernment && <Row k={t('facts.hog')}>{ctx.data.facts.headOfGovernment} <span className="muted">(Wikidata)</span></Row>}
              <Row k={t('facts.languages')}>{f.languages.map((c: string) => displayName('language', c, lang)).join(', ') || '—'}</Row>
              <Row k={t('facts.currencies')}>{f.currencies.map((c: string) => `${displayName('currency', c, lang)} (${c})`).join(', ') || '—'}</Row>
              <Row k={t('facts.un')}>{f.unMember ? t('facts.yes') : t('facts.no')}</Row>
              <Row k={t('facts.landlocked')}>{f.landlocked ? t('facts.yes') : t('facts.no')}</Row>
              <Row k={t('facts.borders')}>{f.borders.length ? <span className="chips small">{f.borders.map((b: Brief) => <button key={b.id} onClick={() => onPick(b.id)}>{b.name}</button>)}</span> : t('facts.noBorders')}</Row>
            </>)}
            {d.type === 'city' && (<>
              <Row k={t('panel.in')}>{d.parent?.name}</Row>
              {f.population > 0 && <Row k={t('facts.population')}>{fmtNum(f.population, lang)} <span className="muted">(GeoNames)</span></Row>}
            </>)}
            {d.type === 'region' && (<><Row k={t('panel.in')}>{d.parent?.name}</Row><Row k={t('facts.code')}>{f.isoCode}</Row></>)}
            {d.type === 'continent' && <Row k={t('facts.countries')}>{f.countries}</Row>}
            {d.lat != null && d.type !== 'continent' && <Row k="GPS">{d.lat.toFixed(2)}°, {d.lon!.toFixed(2)}°</Row>}
            <p className="meta">{t('facts.source')}</p>
          </dl>
        )}
        {tab === 'context' && (<>
          {ctx.loading && <p className="muted">{t('loading')}</p>}
          {ctx.data && !ctx.data.available && <p className="notice">{t(ctx.data.reason === 'snapshot' ? 'ctx.snapshot' : ctx.data.reason === 'not_found' || ctx.data.reason === 'unsupported' ? 'ctx.not_found' : 'ctx.unavailable')}</p>}
          {ctx.error && <p className="notice">{t('ctx.unavailable')}</p>}
          {ctx.data?.available && (<>
            {ctx.data.stale && <p className="notice">{t('ctx.stale')}</p>}
            {ctx.data.overview && <WikiBlock title={t('ctx.overview')} w={ctx.data.overview} />}
            {ctx.data.history && <WikiBlock title={t('ctx.history')} w={ctx.data.history} />}
            {!ctx.data.overview && !ctx.data.history && <p className="notice">{t('ctx.not_found')}</p>}
          </>)}
        </>)}
      </div>
    </aside>
  );
}

interface Relation {
  a: Brief; b: Brief; canGenerate: boolean; unavailable: string[]; contextScope: { a: Brief; b: Brief } | null;
  structural: { sameCountry: boolean; sharedBorder: boolean | null; sameContinent: Brief | null; distanceKm: number | null; sharedLanguages: string[]; sharedCurrencies: string[] };
  context: { available: boolean; reason?: string; article?: Wiki | null; sharedOrganizations?: { name: string; url: string }[] };
  news: { total: number; byCategory: Record<string, Story[]> };
  analysis: null | { origin: 'editorial' | 'automatic'; status: string; createdAt: string; body: Record<string, any>; sources: { publisher: string; title: string; url: string; date: string | null }[] };
}
const SECTIONS = ['current_state', 'recent_events', 'agreements', 'tensions', 'interests', 'trade', 'history', 'hypotheses'];

export function RelationPanel({ a, b, status, onPick, onClose }: { a: string; b: string; status: Status | null; onPick: (id: string) => void; onClose: () => void }) {
  const { t, lang } = useI18n();
  const rel = useApi<Relation>(`/relations${qs({ a, b, lang })}`);
  const [gen, setGen] = useState<'idle' | 'busy' | 'insufficient' | 'error'>('idle');
  const d = rel.data, s = d?.structural;

  async function generate() {
    setGen('busy');
    try { await api('/relations/analysis', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a, b, lang }) }); setGen('idle'); rel.reload(); }
    catch (e: any) { setGen(e?.code === 'insufficient_sources' ? 'insufficient' : 'error'); }
  }

  return (
    <aside className="panel" aria-label={t('rel.title')}>
      <header>
        <button className="close" onClick={onClose} aria-label={t('panel.close')}>×</button>
        <p className="kicker">{t('rel.title')}</p>
        {d && <h2 className="pair"><button className="link a" onClick={() => onPick(d.a.id)}>{d.a.name}</button><span>↔</span><button className="link b" onClick={() => onPick(d.b.id)}>{d.b.name}</button></h2>}
        {rel.loading && !d && <p className="muted">{t('loading')}</p>}
        {rel.error && <p className="muted">{t('error.load')} <button className="link" onClick={rel.reload}>{t('error.retry')}</button></p>}
      </header>
      {d && s && (
        <div className="panel-body">
          <section>
            <h3>{t('rel.structural')}</h3>
            <dl className="facts">
              {s.sameCountry && <Row k={t('rel.sameCountry')}>{t('facts.yes')}</Row>}
              {s.sharedBorder != null && <Row k={t('rel.border')}>{s.sharedBorder ? t('facts.yes') : t('facts.no')}</Row>}
              {s.distanceKm != null && <Row k={t('rel.distance')}>{fmtNum(s.distanceKm, lang)} km</Row>}
              {s.sameContinent && <Row k={t('rel.sameContinent')}>{s.sameContinent.name}</Row>}
              {s.sharedLanguages.length > 0 && <Row k={t('rel.languages')}>{s.sharedLanguages.map((c) => displayName('language', c, lang)).join(', ')}</Row>}
              {s.sharedCurrencies.length > 0 && <Row k={t('rel.currencies')}>{s.sharedCurrencies.map((c) => displayName('currency', c, lang)).join(', ')}</Row>}
              {d.context.sharedOrganizations && d.context.sharedOrganizations.length > 0 && (
                <Row k={`${t('rel.orgs')} (${d.context.sharedOrganizations.length})`}>
                  <span className="orgs">{d.context.sharedOrganizations.map((o, i) => <span key={o.url}>{i > 0 && ' · '}<a href={o.url} target="_blank" rel="noopener noreferrer">{o.name}</a></span>)}</span>
                  <span className="meta">Wikidata</span>
                </Row>
              )}
            </dl>
          </section>
          <section>
            <h3>{t('rel.context')}</h3>
            {d.contextScope && <p className="muted">{t('rel.contextScope', { a: d.contextScope.a.name, b: d.contextScope.b.name })}</p>}
            {d.context.available ? (d.context.article ? <WikiBlock title={d.context.article.title} w={d.context.article} /> : <p className="notice">{t('rel.noArticle')}</p>)
              : <p className="notice">{t(d.context.reason === 'snapshot' ? 'ctx.snapshot' : d.context.reason === 'unsupported' ? 'rel.noArticle' : 'ctx.unavailable')}</p>}
          </section>
          <section>
            <h3>{t('rel.news')}</h3>
            <p className="muted">{t('rel.newsHelp')}</p>
            {d.news.total === 0 && <p className="notice">{t('rel.noNews')}</p>}
            {Object.entries(d.news.byCategory).map(([cat, list]) => (
              <details key={cat} open={Object.keys(d.news.byCategory).length <= 2}>
                <summary>{t(`cat.${cat}` as Key)} <span className="n">{list.length}</span></summary>
                {list.map((st) => <StoryCard key={st.id} s={st} onTerritory={onPick} features={status?.features} />)}
              </details>
            ))}
          </section>
          <section>
            <h3>{t('rel.analysis')}</h3>
            {d.analysis ? (<>
              <p className={`notice ${d.analysis.origin}`}>{t(d.analysis.origin === 'editorial' ? 'rel.editorial' : 'rel.automatic')} · {fmtDate(d.analysis.createdAt, lang)}</p>
              {SECTIONS.map((k) => {
                const items: { text: string; sources: number[] }[] = d.analysis!.body[k] ?? [];
                if (!items.length) return null;
                return (
                  <div key={k} className={k === 'hypotheses' ? 'hypo' : ''}>
                    <h4>{t(`rel.s.${k}` as Key)}</h4>
                    {k === 'hypotheses' && <p className="muted">{t('rel.hypoNote')}</p>}
                    <ul>{items.map((it, i) => <li key={i}>{it.text} {it.sources.map((n) => d.analysis!.sources[n - 1] && <a key={n} className="cite" href={d.analysis!.sources[n - 1].url} target="_blank" rel="noopener noreferrer" title={`${d.analysis!.sources[n - 1].publisher} — ${d.analysis!.sources[n - 1].title}`}>[{n}]</a>)}</li>)}</ul>
                  </div>
                );
              })}
              {d.analysis.body.gaps?.length > 0 && (<><h4>{t('rel.gaps')}</h4><ul>{d.analysis.body.gaps.map((g: string, i: number) => <li key={i}>{g}</li>)}</ul></>)}
              <h4>{t('story.sources')}</h4>
              <ol className="srcs">{d.analysis.sources.map((x, i) => <li key={i}><a href={x.url} target="_blank" rel="noopener noreferrer">{x.title}</a> <span className="meta">{x.publisher}{x.date && ` · ${x.date}`}</span></li>)}</ol>
            </>) : (<>
              <p className="notice">{t('rel.noAnalysis')}</p>
              {d.canGenerate && <button className="btn" disabled={gen === 'busy'} onClick={generate}>{gen === 'busy' ? t('rel.generating') : t('rel.generate')}</button>}
              {gen === 'insufficient' && <p className="muted">{t('rel.insufficient')}</p>}
              {gen === 'error' && <p className="muted">{t('error.load')}</p>}
            </>)}
          </section>
          <section>
            <h3>{t('rel.missing')}</h3>
            <ul className="muted">{d.unavailable.map((k) => <li key={k}>{t(`rel.missing.${k}` as Key)}</li>)}</ul>
          </section>
        </div>
      )}
    </aside>
  );
}
