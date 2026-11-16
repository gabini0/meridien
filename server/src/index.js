import { config } from './config.js';
import { createApp } from './app.js';

const { app, collector } = createApp(config);
collector.schedule();
app.listen(config.port, () => console.log(`Méridien — API sur http://localhost:${config.port} (collecte toutes les ${config.collectIntervalMin} min)`));
