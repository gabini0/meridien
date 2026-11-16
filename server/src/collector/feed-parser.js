// Analyse RSS 2.0, RDF (RSS 1.0) et Atom vers un format d'article normalisé.
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', processEntities: true, htmlEntities: true, trimValues: true });
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const text = (v) => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));

export function cleanText(html, max = 600) {
  let s = text(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').replace(/ ([.,])/g, '$1').trim();
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return s;
}

function toIso(v) {
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function httpUrl(u) {
  try { const x = new URL(text(u).trim()); return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : null; } catch { return null; }
}

function image(it) {
  const cands = [
    ...arr(it['media:thumbnail']).map((m) => ({ u: m?.['@_url'], w: Number(m?.['@_width'] ?? 0) })),
    ...arr(it['media:content']).filter((m) => !m?.['@_medium'] || m['@_medium'] === 'image' || /^image/.test(m?.['@_type'] ?? '')).map((m) => ({ u: m?.['@_url'], w: Number(m?.['@_width'] ?? 0) })),
    ...arr(it['media:group']).flatMap((g) => arr(g?.['media:content'])).map((m) => ({ u: m?.['@_url'], w: Number(m?.['@_width'] ?? 0) })),
    ...arr(it.enclosure).filter((e) => /^image/.test(e?.['@_type'] ?? '')).map((e) => ({ u: e?.['@_url'], w: 0 })),
  ].filter((c) => httpUrl(c.u));
  cands.sort((a, b) => b.w - a.w);
  return cands.length ? httpUrl(cands[0].u) : null;
}

export function parseFeed(xml) {
  const doc = parser.parse(xml);
  const out = [];
  const rssItems = doc?.rss?.channel?.item ?? doc?.['rdf:RDF']?.item;
  if (rssItems) {
    for (const it of arr(rssItems)) {
      out.push({
        url: httpUrl(it.link) ?? httpUrl(it.guid) ?? httpUrl(it['@_rdf:about']),
        title: cleanText(it.title, 400),
        excerpt: cleanText(it.description ?? it['content:encoded']),
        publishedAt: toIso(it.pubDate ?? it['dc:date']),
        updatedAt: toIso(it['atom:updated'] ?? it['dcterms:modified']),
        author: cleanText(it['dc:creator'] ?? it.author, 120) || null,
        feedCategories: arr(it.category).map((c) => cleanText(c, 80)).filter(Boolean),
        imageUrl: image(it),
      });
    }
  } else if (doc?.feed) {
    for (const e of arr(doc.feed.entry)) {
      const links = arr(e.link);
      const link = links.find((l) => (l?.['@_rel'] ?? 'alternate') === 'alternate') ?? links[0];
      out.push({
        url: httpUrl(link?.['@_href'] ?? link),
        title: cleanText(e.title, 400),
        excerpt: cleanText(e.summary ?? e.content),
        publishedAt: toIso(e.published ?? e.updated),
        updatedAt: toIso(e.updated),
        author: cleanText(arr(e.author)[0]?.name, 120) || null,
        feedCategories: arr(e.category).map((c) => cleanText(c?.['@_term'] ?? c, 80)).filter(Boolean),
        imageUrl: image(e),
      });
    }
  } else {
    throw new Error('Format de flux non reconnu (ni RSS, ni RDF, ni Atom)');
  }
  // Un article sans URL ou sans titre n'est pas traçable : il est écarté.
  return out.filter((a) => a.url && a.title);
}
