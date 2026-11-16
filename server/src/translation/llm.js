// Traduction et synthèse assistées (optionnelles). Sans clé ANTHROPIC_API_KEY, le module est
// désactivé : les contenus restent dans leur langue d'origine et aucune synthèse n'est produite.
// Les textes produits sont toujours marqués « automatique, non relu » et ne s'appuient que sur
// les éléments sourcés fournis dans la requête.
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';

const LANG = { fr: 'français', en: 'English' };

export function createLlm({ db, config }) {
  const enabled = !!config.anthropicApiKey;
  const client = enabled ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;
  const getTr = db.prepare('SELECT text FROM translations WHERE hash = ? AND lang = ?');
  const putTr = db.prepare('INSERT OR REPLACE INTO translations (hash, lang, text, provider, created_at) VALUES (?,?,?,?,?)');
  const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

  async function json(system, user, schema, maxTokens = 8000) {
    const res = await client.beta.messages.create({
      model: config.llmModel,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (res.stop_reason === 'refusal') throw new Error('Requête refusée par le modèle');
    if (res.stop_reason === 'max_tokens') throw new Error('Réponse tronquée');
    const block = res.content.find((b) => b.type === 'text');
    return JSON.parse(block.text);
  }

  /** Traduction en cache si disponible, sinon null (ne déclenche aucun appel). */
  const cached = (text, lang) => (text ? getTr.get(hash(text), lang)?.text ?? null : null);

  /** Traduit un lot de textes ; renvoie un tableau aligné. */
  async function translate(texts, lang) {
    if (!enabled) throw Object.assign(new Error('translation_disabled'), { status: 503 });
    const out = texts.map((t) => cached(t, lang));
    const todo = [...new Set(texts.filter((t, i) => t && !out[i]))];
    if (todo.length) {
      const r = await json(
        `You translate news headlines and excerpts into ${LANG[lang]}. Translate faithfully and neutrally: do not add, remove, soften or interpret information. Keep proper nouns, figures and quotations exact. Return one translation per input, in the same order.`,
        JSON.stringify(todo),
        { type: 'object', properties: { translations: { type: 'array', items: { type: 'string' } } }, required: ['translations'], additionalProperties: false },
      );
      if (r.translations.length !== todo.length) throw new Error('Traduction incomplète');
      const now = new Date().toISOString();
      todo.forEach((t, i) => putTr.run(hash(t), lang, r.translations[i], config.llmModel, now));
    }
    return texts.map((t) => cached(t, lang));
  }

  /**
   * Analyse d'une relation bilatérale à partir du seul dossier fourni (faits structurels,
   * extraits encyclopédiques, articles de presse). Chaque affirmation renvoie à des sources numérotées.
   */
  async function relationAnalysis({ a, b, lang, dossier, sources }) {
    if (!enabled) throw Object.assign(new Error('analysis_disabled'), { status: 503 });
    const section = { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, sources: { type: 'array', items: { type: 'integer' } } }, required: ['text', 'sources'], additionalProperties: false } };
    const keys = ['current_state', 'recent_events', 'agreements', 'tensions', 'interests', 'trade', 'history', 'hypotheses'];
    return json(
      `You are an editor at an international-affairs publication writing in ${LANG[lang]} about the relationship between ${a} and ${b}.
Use ONLY the numbered material in the dossier. Every statement must list the source numbers that support it; if the dossier does not support a point, leave that section empty rather than drawing on memory. Never invent quotes, figures, dates or events.
Distinguish established facts from official statements ("X says…") and from analysis. Write neutrally and do not adopt one party's framing. Do not rate or score the relationship.
"hypotheses" may only contain possible developments explicitly framed as hypotheses, each grounded in cited material.
"gaps" lists, in plain words, what the dossier does not cover (for example trade figures) so readers know the limits of this analysis.`,
      `Sources:\n${sources.map((s, i) => `[${i + 1}] ${s.publisher} — ${s.title} (${s.date ?? 'n.d.'})`).join('\n')}\n\nDossier:\n${dossier}`,
      { type: 'object', properties: { ...Object.fromEntries(keys.map((k) => [k, section])), gaps: { type: 'array', items: { type: 'string' } } }, required: [...keys, 'gaps'], additionalProperties: false },
      16000,
    );
  }

  return { enabled, provider: enabled ? config.llmModel : null, cached, translate, relationAnalysis };
}
