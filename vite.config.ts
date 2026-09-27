import { defineConfig, type Plugin, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateEnquiry } from './src/lib/matching.mjs';

function localEnquiries(): Plugin {
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.url !== '/api/enquiries') return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.statusCode = 405; res.end(JSON.stringify({ error: 'Метод не поддерживается.' })); return; }
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) { res.statusCode = 403; res.end(JSON.stringify({ error: 'Недопустимый источник запроса.' })); return; }
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 8192) { res.statusCode = 413; res.end(JSON.stringify({ error: 'Заявка слишком большая.' })); return; } }
      const body = JSON.parse(raw);
      const error = validateEnquiry(body);
      if (error) { res.statusCode = 400; res.end(JSON.stringify({ error })); return; }
      const id = randomUUID();
      await mkdir(resolve('.local'), { recursive: true });
      await appendFile(resolve('.local/enquiries.jsonl'), JSON.stringify({ id, createdAt: new Date().toISOString(), name: body.name.trim(), phone: body.phone.replace(/\D/g, ''), age: Number(body.age), group: body.group, consent: true, context: typeof body.context === 'string' ? body.context.slice(0, 400) : '', mode: 'local-preview' }) + '\n', 'utf8');
      res.statusCode = 201; res.end(JSON.stringify({ id, mode: 'local-preview' }));
    } catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'Не удалось сохранить заявку. Попробуйте ещё раз.' })); }
  };
  return { name: 'youkey-local-enquiries', configureServer(server) { server.middlewares.use(middleware); }, configurePreviewServer(server) { server.middlewares.use(middleware); } };
}
export default defineConfig({ plugins: [react(), localEnquiries()], server: { host: '127.0.0.1', port: 5173, strictPort: true }, preview: { host: '127.0.0.1', port: 4173, strictPort: true } });
