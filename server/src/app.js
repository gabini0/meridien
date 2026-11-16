import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { openDb } from './db.js';
import { loadGeo } from './geo/index.js';
import { createCollector } from './collector/collector.js';
import { createContext } from './context/wikipedia.js';
import { createLlm } from './translation/llm.js';
import { createApi } from './api/routes.js';

export function createApp(config, overrides = {}) {
  const db = openDb(config.dbPath);
  const geo = loadGeo(config.geoDir);
  const collector = createCollector({ db, geo, config, ...overrides.collector });
  const context = createContext({ db, config, ...overrides.context });
  const llm = createLlm({ db, config });
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
      'content-security-policy': "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; child-src blob:; connect-src 'self'" });
    next();
  });
  app.use('/api', createApi({ db, geo, config, collector, context, llm }));
  if (existsSync(config.webDist)) {
    app.use(express.static(config.webDist, { maxAge: '1h' }));
    app.get('*', (req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
  }
  return { app, db, geo, collector };
}
