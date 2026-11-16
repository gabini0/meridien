import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_SNAPSHOT=1 : version statique autonome (chemins relatifs, données dans public-snapshot/)
const snapshot = !!process.env.VITE_SNAPSHOT;

export default defineConfig({
  plugins: [react()],
  base: snapshot ? './' : '/',
  publicDir: snapshot ? 'public-snapshot' : 'public',
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  build: { chunkSizeWarningLimit: 1500, outDir: snapshot ? 'dist-snapshot' : 'dist' },
});
