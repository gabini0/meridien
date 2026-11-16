import { useEffect, useState } from 'react';
import { api, qs, useApi, type Period, type Story, type StoryList, type Status } from './api';
import { fmtDateTime, useI18n, type Key } from './i18n';

export function PeriodTabs({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const { t } = useI18n();
  return (
    <div className="tabs" role="tablist">
      {(['today', 'week', 'month'] as Period[]).map((p) => (
        <button key={p} role="tab" aria-selected={value === p} className={value === p ? 'on' : ''} onClick={() => onChange(p)}>{t(`period.${p}` as Key)}</button>
      ))}
    </div>
  );
}

export function CategoryFilter({ value, onChange, categories }: { value: string; onChange: (c: string) => void; categories: string[] }) {
  const { t } = useI18n();
  return (
    <div className="chips" role="group">
      <button className={!value ? 'on' : ''} onClick={() => onChange('')}>{t('cat.all')}</button>
      {categories.filter((c) => c !== 'other').map((c) => (
        <button key={c} className={value === c ? 'on' : ''} aria-pressed={value === c} onClick={() => onChange(value === c ? '' : c)}>{t(`cat.${c}` as Key)}</button>
      ))}
    </div>
  );
}

export function Badges({ s }: { s: Story }) {
  const { t } = useI18n();
  const v = s.verification;
  const crit = s.importance.criteria.filter((c) => c.pts > 0).map((c) => t(`imp.${c.k}` as Key, { n: c.k === 'category' ? t(`cat.${c.n}` as Key) : c.n })).join(' · ');
  const help = v.status === 'single_source' || v.status === 'corroborated' ? t(`ver.${v.status}.help` as Key) : v.note ?? '';
  return (
    <div className="badges">
      <span className={`badge imp-${s.importance.level}`} title={`${t(s.importance.setBy === 'editorial' ? 'imp.editorial' : 'imp.auto')}${crit ? ' — ' + crit : ''}`}>{t(`imp.${s.importance.level}` as Key)}</span>
      <span className="badge cat">{t(`cat.${s.category}` as Key)}</span>
      <span className={`badge ver-${v.status}`} title={help}>{t(`ver.${v.status}` as Key, { n: v.independentSources })}</span>
      {s.lead && s.lead.claimType !== 'report' && <span className="badge claim">{t(`claim.${s.lead.claimType}` as Key)}</span>}
      {s.updated && <span className="badge upd">{t('story.updated')}</span>}
    </div>
  );
}

export function StoryCard({ s, onLocate, onTerritory, features, big }: { s: Story; onLocate?: (id: string) => void; onTerritory?: (id: string) => void; features?: Status['features']; big?: boolean }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const detail = useApi<Story>(open ? `/stories/${s.id}${qs({ lang })}` : null);
  const lead = s.lead;
  if (!lead) return null;
  const crit = s.importance.criteria.filter((c) => c.pts > 0);
  const untranslated = detail.data?.articles?.some((a) => a.lang !== lang && !a.translated);

  async function translate() {
    setBusy(true);
    try { await api(`/stories/${s.id}/translate${qs({ lang })}`, { method: 'POST' }); detail.reload(); } catch { /* l'état non traduit reste affiché */ } finally { setBusy(false); }
  }

  return (
    <article className={`story${big ? ' big' : ''}`}>
      {s.image && imgOk && (
        <figure>
          <img src={s.image.url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImgOk(false)} />
          <figcaption>{t('story.photo')} : {s.image.credit}</figcaption>
        </figure>
      )}
      <div className="story-body">
        <Badges s={s} />
        <h3><a href={lead.url} target="_blank" rel="noopener noreferrer">{lead.title}</a></h3>
        {lead.translated && <p className="note">{t('story.translated')} — {lead.originalTitle}</p>}
        {lead.lang !== lang && !lead.translated && <p className="note">{t('story.notTranslated')}</p>}
        {lead.excerpt && <p className="excerpt"><span className="label">{t('story.excerpt')} ({lead.source.name})</span> {lead.excerpt}</p>}
        {s.verification.note && <p className="correction">{s.verification.note}</p>}
        <p className="meta">
          <time dateTime={s.lastSeen}>{fmtDateTime(s.lastSeen, lang)}</time>
          {s.location && <> · {onLocate ? <button className="link" onClick={() => onLocate(s.location!.id)}>⌖ {s.location.name}</button> : s.location.name}</>}
          {' · '}{s.sources.map((x) => x.name).join(', ')}
        </p>
        <div className="actions">
          {onLocate && s.location && <button className="btn sm" onClick={() => onLocate(s.location!.id)}>{t('story.onMap')}</button>}
          <button className="btn sm ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? t('story.hide') : t('story.details')}</button>
        </div>
        {open && (
          <div className="detail">
            {detail.loading && <p className="muted">{t('loading')}</p>}
            {detail.error && <p className="muted">{t('error.load')} <button className="link" onClick={detail.reload}>{t('error.retry')}</button></p>}
            {detail.data && (
              <>
                <h4>{t('story.sources')}</h4>
                <ul className="articles">
                  {detail.data.articles!.map((a) => (
                    <li key={a.id}>
                      <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a>
                      <span className="meta">
                        {a.source.name}{a.source.primary && ` (${t('story.primary')})`} · {t('story.published')} {fmtDateTime(a.publishedAt, lang)} · {t(`claim.${a.claimType}` as Key)}
                        {a.lang !== lang && ` · ${t('story.original')} : ${a.lang.toUpperCase()}`}{a.translated && ` · ${t('story.translated')}`}
                        {a.revisedAt && ` · ${t('story.updated')} ${fmtDateTime(a.revisedAt, lang)}`}
                      </span>
                      {a.previousTitle && <span className="meta">{t('story.previousTitle')} : « {a.previousTitle} »</span>}
                    </li>
                  ))}
                </ul>
                {untranslated && features?.translation && <button className="btn sm ghost" disabled={busy} onClick={translate}>{busy ? t('story.translating') : t('story.translate')}</button>}
                {s.territories.length > 0 && (<>
                  <h4>{t('story.actors')}</h4>
                  <div className="chips small">{s.territories.map((x) => <button key={x.id} onClick={() => (onTerritory ?? onLocate)?.(x.id)}>{x.name}</button>)}</div>
                </>)}
                <h4>{t('imp.title')} : {t(`imp.${s.importance.level}` as Key)}</h4>
                <p className="muted">{t(s.importance.setBy === 'editorial' ? 'imp.editorial' : 'imp.auto')}{crit.length > 0 && ' — '}{crit.map((c) => t(`imp.${c.k}` as Key, { n: c.k === 'category' ? t(`cat.${c.n}` as Key) : c.n })).join(' · ')}</p>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** Liste paginée de sujets avec états vides et d'erreur explicites. */
export function StoryFeed({ period, category, territory, onLocate, onTerritory, status, limit = 12, hero = false, onNav }: {
  period: Period; category: string; territory?: string; onLocate?: (id: string) => void; onTerritory?: (id: string) => void; status: Status | null; limit?: number; hero?: boolean; onNav?: (hash: string) => void;
}) {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<Story[]>([]);
  const [state, setState] = useState<{ loading: boolean; error: boolean; total: number; hasMore: boolean }>({ loading: true, error: false, total: 0, hasMore: false });
  const [nonce, setNonce] = useState(0);
  const key = `${period}|${category}|${territory ?? ''}|${lang}|${nonce}`;

  async function load(offset: number) {
    setState((s) => ({ ...s, loading: true, error: false }));
    try {
      const r = await api<StoryList>(`/stories${qs({ period, category, territory, lang, limit, offset })}`);
      setItems((prev) => (offset ? [...prev, ...r.items] : r.items));
      setState({ loading: false, error: false, total: r.total, hasMore: r.hasMore });
    } catch { setState((s) => ({ ...s, loading: false, error: true })); }
  }
  useEffect(() => { load(0); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.error && !items.length) return <div className="empty"><p>{t('error.load')}</p><button className="btn" onClick={() => setNonce((n) => n + 1)}>{t('error.retry')}</button></div>;
  if (state.loading && !items.length) return <div className="skeletons" aria-busy="true"><div /><div /><div /></div>;
  if (!items.length) {
    const noData = status && status.articles === 0;
    return (
      <div className="empty">
        <h3>{t('empty.title')}</h3>
        <p>{noData ? t('empty.nodata') : t('empty.filtered')}</p>
        {noData && onNav && <button className="btn" onClick={() => onNav('#/sources')}>{t('empty.seeSources')}</button>}
      </div>
    );
  }
  return (
    <div className="feed">
      <p className="muted count">{t('home.count', { n: state.total })} — {t('home.sort')}</p>
      {items.map((s, i) => <StoryCard key={s.id} s={s} big={hero && i === 0} onLocate={onLocate} onTerritory={onTerritory} features={status?.features} />)}
      {state.hasMore && <button className="btn more" disabled={state.loading} onClick={() => load(items.length)}>{state.loading ? t('loading') : t('home.more')}</button>}
    </div>
  );
}
