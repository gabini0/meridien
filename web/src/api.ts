import { useEffect, useState } from 'react';
import type { Lang } from './i18n';
import { SNAPSHOT, snapApi } from './snapshot';

export type Period = 'today' | 'week' | 'month';
export interface Brief { id: string; type: 'continent' | 'country' | 'region' | 'city'; name: string; lon: number | null; lat: number | null; country: string | null }
export interface Article {
  id: number; url: string; lang: Lang; publishedAt: string; title: string; excerpt: string | null; translated: boolean; originalTitle: string | null;
  source: { id: string; name: string; homepage: string | null; primary: boolean }; author: string | null; category: string;
  claimType: 'report' | 'statement' | 'analysis'; revisedAt: string | null; previousTitle: string | null;
}
export interface Story {
  id: number; firstSeen: string; lastSeen: string; category: string; lead: Article | null;
  image: { url: string; credit: string; articleUrl: string } | null; territories: Brief[]; location: Brief | null;
  importance: { level: 'major' | 'important' | 'notable'; score: number; setBy: 'automatic' | 'editorial'; criteria: { k: 'sources' | 'countries' | 'languages' | 'category'; n: number | string; pts: number }[] };
  verification: { status: 'single_source' | 'corroborated' | 'validated' | 'disputed' | 'corrected'; independentSources: number; articles: number; note: string | null };
  updated: boolean; sources: { id: string; name: string }[]; articles?: Article[];
}
export interface StoryList { total: number; hasMore: boolean; items: Story[] }
export interface Wiki { title: string; extract: string; url: string; image: string | null }
export interface Status { articles: number; stories: number; lastSuccessfulCollection: string | null; feeds: { total: number; reachable: number; attempted: number }; features: { translation: boolean; relationAnalysis: boolean; editorialReview: boolean }; categories: string[] }

export class ApiError extends Error { constructor(public status: number, public code: string) { super(code); } }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (SNAPSHOT) {
    try { return (await snapApi(path, init)) as T; } catch (e: any) { throw new ApiError(e?.status ?? 0, e?.code ?? 'network'); }
  }
  const res = await fetch(`/api${path}`, init);
  let body: any = null;
  try { body = await res.json(); } catch { /* réponse non JSON */ }
  if (!res.ok) throw new ApiError(res.status, body?.error ?? 'error');
  return body as T;
}

export const qs = (o: Record<string, string | number | null | undefined>) =>
  '?' + Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');

/** Chargement déclaratif avec états explicites (chargement, erreur, relance). */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [state, set] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: !!path });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) { set({ data: null, error: null, loading: false }); return; }
    let live = true;
    set((s) => ({ ...s, loading: true, error: null }));
    api<T>(path).then((data) => live && set({ data, error: null, loading: false }))
      .catch((e) => live && set({ data: null, error: e instanceof ApiError ? e : new ApiError(0, 'network'), loading: false }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, n, ...deps]);
  return { ...state, reload: () => setN((x) => x + 1) };
}
