import { config } from '../config.js';
import { openDb } from '../db.js';
import { loadGeo } from '../geo/index.js';
import { createCollector } from './collector.js';

const db = openDb(config.dbPath);
const s = await createCollector({ db, geo: loadGeo(config.geoDir), config }).runOnce();
for (const r of s.results) console.log(r.ok ? `OK   ${r.feed} (+${r.added ?? 0}${r.notModified ? ', inchangé' : ''})` : `KO   ${r.feed} — ${r.error}`);
