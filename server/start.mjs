import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createBackend } from './backend.mjs';
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const localOnly = ['127.0.0.1', 'localhost', '::1'].includes(host);
const backend = createBackend({ localOnly, publicOrigin: process.env.PUBLIC_ORIGIN || '' });
const root = resolve('dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const server = createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  backend.middleware(req, res, () => {
    if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; res.end(); return; }
    let pathname; try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.statusCode = 400; res.end(); return; }
    let file = resolve(root, '.' + pathname);
    if (!file.startsWith(root + sep) && file !== root) { res.statusCode = 403; res.end(); return; }
    try { if (statSync(file).isDirectory()) file = resolve(file, 'index.html'); statSync(file); } catch { if (extname(pathname)) { res.statusCode = 404; res.end('Not found'); return; } file = resolve(root, 'index.html'); }
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    if (req.method === 'HEAD') res.end(); else createReadStream(file).on('error', () => { res.statusCode = 500; res.end(); }).pipe(res);
  });
});
server.listen(port, host, () => console.log(`YOUKEY: http://${host}:${port}\nAdmin: http://${host}:${port}/admin`));
function close() { server.close(() => { backend.close(); process.exit(0); }); }
process.on('SIGINT', close); process.on('SIGTERM', close);
