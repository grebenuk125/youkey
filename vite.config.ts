import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createBackend } from './server/backend.mjs';
function backendPlugin(): Plugin {
  return { name: 'youkey-backend', configureServer(server) { const backend = createBackend(); server.middlewares.use(backend.middleware); server.httpServer?.once('close', () => backend.close()); }, configurePreviewServer(server) { const backend = createBackend(); server.middlewares.use(backend.middleware); server.httpServer?.once('close', () => backend.close()); } };
}
export default defineConfig({ plugins: [react(), backendPlugin()], server: { host: '127.0.0.1', port: 5173, strictPort: true, fs: { deny: ['.env', '.env.*', '**/.git/**', '**/.local/**', '**/server/**'] } }, preview: { host: '127.0.0.1', port: 4173, strictPort: true } });
