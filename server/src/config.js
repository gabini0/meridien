import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

export const config = {
  root,
  port: Number(env.PORT ?? 8787),
  dbPath: env.DB_PATH ?? path.join(root, 'data/meridien.db'),
  geoDir: path.join(root, 'data/geo'),
  webDist: path.join(root, '../web/dist'),
  // Collecte
  collectIntervalMin: Number(env.COLLECT_INTERVAL_MIN ?? 15),
  collectOnStart: env.COLLECT_ON_START !== '0',
  fetchTimeoutMs: Number(env.FETCH_TIMEOUT_MS ?? 15000),
  retentionDays: Number(env.RETENTION_DAYS ?? 45),
  userAgent: env.HTTP_USER_AGENT ?? 'MeridienBot/0.1 (news aggregator)',
  // Éditorial
  adminToken: env.ADMIN_TOKEN ?? null,
  // Traduction / synthèse (désactivé si aucune clé)
  anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
  llmModel: env.LLM_MODEL ?? 'claude-opus-5-5',
};
