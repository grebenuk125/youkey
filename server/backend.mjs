import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import nodemailer from 'nodemailer';
import { validateEnquiry } from '../src/lib/matching.mjs';

const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const states = ['new', 'contacted', 'booked', 'attended', 'paid', 'archived'];
const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function validateSite(site) {
  if (!site || !Array.isArray(site.groups) || !Array.isArray(site.tariffs) || !Array.isArray(site.styles) || !Array.isArray(site.faq) || !site.settings) throw fail('Некорректные данные сайта.');
  if (site.groups.length > 150) throw fail('Слишком много групп.');
  const ids = new Set();
  for (const g of site.groups) {
    if (typeof g.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(g.id) || ids.has(g.id)) throw fail('У каждой группы должен быть уникальный ID.');
    ids.add(g.id);
    if (typeof g.style !== 'string' || !g.style.trim() || g.style.length > 80 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(g.time)) throw fail('Проверьте направление и время группы.');
    if (!['weekdays', 'weekend'].includes(g.dayType) || typeof g.days !== 'string' || !g.days.trim() || g.days.length > 40) throw fail('Проверьте дни группы.');
    for (const key of ['min', 'max', 'capacity', 'enrolled', 'duration']) if (g[key] != null && (!Number.isInteger(g[key]) || g[key] < 0 || g[key] > 1000)) throw fail('Числовые поля группы должны быть целыми неотрицательными числами.');
    if (g.min != null && (g.min < 4 || g.min > 100)) throw fail('Возраст группы должен быть от 4 до 100 лет.');
    if (g.max != null && (g.max > 100 || (g.min != null && g.max < g.min))) throw fail('Проверьте верхнюю границу возраста.');
    if (g.capacity != null && g.enrolled != null && g.enrolled > g.capacity) throw fail('Число учеников не может превышать вместимость.');
    for (const key of ['teacher', 'level']) if (typeof g[key] !== 'string' || g[key].length > 160) throw fail('Проверьте преподавателя и уровень.');
  }
  if (site.tariffs.length < 1 || site.tariffs.length > 10) throw fail('Добавьте от 1 до 10 тарифов.');
  for (const t of site.tariffs) if (![t.n, t.price, t.discounted].every(Number.isFinite) || t.n < 1 || t.price < 0 || t.discounted < 0 || t.discounted > t.price || typeof t.text !== 'string') throw fail('Проверьте цены: стоимость со скидкой не должна превышать обычную.');
  for (const [q, a] of site.faq) if (typeof q !== 'string' || typeof a !== 'string' || q.length > 400 || a.length > 5000) throw fail('Проверьте вопросы и ответы.');
  for (const s of site.styles) if (typeof s.name !== 'string' || typeof s.text !== 'string' || s.text.length > 5000) throw fail('Проверьте описание направления.');
  if (typeof site.settings.address !== 'string' || site.settings.address.length > 250) throw fail('Проверьте адрес школы.');
  if (!Array.isArray(site.ages) || site.ages.length !== 4 || site.ages.some(a => !/^(4-6|7-10|11-14|15-17)$/.test(a.slug) || typeof a.title !== 'string' || typeof a.text !== 'string')) throw fail('Проверьте возрастные программы.');
  if (site.media && Object.values(site.media).some(value => typeof value !== 'string' || !/^\/uploads\/[a-f0-9-]+\.(jpg|png|webp)$/.test(value))) throw fail('Используйте фотографии, загруженные через админку.');
  if (site.videos && Object.values(site.videos).some(value => typeof value !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(value))) throw fail('Введите 11 символов ID видео YouTube.');
  if (site.events && (!Array.isArray(site.events) || site.events.length > 100 || site.events.some(e => typeof e.id !== 'string' || typeof e.title !== 'string' || e.title.length > 160 || typeof e.text !== 'string' || e.text.length > 4000 || typeof e.date !== 'string' || e.date.length > 100 || typeof e.active !== 'boolean'))) throw fail('Проверьте события.');
  for (const key of ['telegram', 'vk']) { try { const u = new URL(site.settings[key]); if (u.protocol !== 'https:') throw new Error(); } catch { throw fail('Ссылки должны начинаться с https://.'); } }
  return site;
}
export function createBackend({ dataDir = resolve('.local'), localOnly = true, publicOrigin = '', mailTransportFactory } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(resolve(dataDir, 'youkey.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS enquiries (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, age INTEGER, groupId TEXT, groupLabel TEXT NOT NULL, context TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'booking', message TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', notes TEXT NOT NULL DEFAULT '', emailState TEXT NOT NULL DEFAULT 'not_configured', emailAttempts INTEGER NOT NULL DEFAULT 0, emailError TEXT NOT NULL DEFAULT '', nextAttempt INTEGER NOT NULL DEFAULT 0, deliveryTo TEXT NOT NULL DEFAULT '');
    CREATE INDEX IF NOT EXISTS enquiry_created ON enquiries(createdAt DESC);
  `);
  const getConfig = key => { const row = db.prepare('SELECT value FROM config WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; };
  const setConfig = (key, value) => db.prepare('INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  if (!getConfig('site')) setConfig('site', JSON.parse(readFileSync(new URL('../src/site-seed.json', import.meta.url), 'utf8')));
  if (!localOnly && (!getConfig('password') || !publicOrigin.startsWith('https://'))) throw new Error('Для публичного запуска нужны пароль администратора и PUBLIC_ORIGIN с https://.');
  const keyFile = resolve(dataDir, 'mail.key');
  if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
  const encryptionKey = readFileSync(keyFile);
  function encrypt(value) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${data.toString('hex')}`; }
  function decrypt(value) { const [iv, tag, data] = value.split('.').map(v => Buffer.from(v, 'hex')); const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'); }
  const sessions = { create(res) { const token = randomBytes(32).toString('hex'); const expires = Date.now() + 12 * 60 * 60 * 1000; db.prepare('INSERT INTO sessions VALUES(?,?)').run(token, expires); res.setHeader('Set-Cookie', `youkey_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${localOnly ? '' : '; Secure'}`); return token; }, read(req) { const token = /(?:^|;\s*)youkey_session=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1]; return token && db.prepare('SELECT token FROM sessions WHERE token=? AND expires>?').get(token, Date.now()) ? token : null; } };
  const rate = new Map();
  function throttle(req, action, max) { const key = `${action}:${req.socket.remoteAddress}`; const now = Date.now(); if (rate.size > 5000) for (const [k, v] of rate) if (v.until < now) rate.delete(k); const state = rate.get(key); if (!state || state.until < now) { rate.set(key, { count: 1, until: now + 600000 }); return; } if (++state.count > max) throw fail('Слишком много попыток. Попробуйте через 10 минут.', 429); }
  function safeMail() { const cfg = getConfig('mail') || { to: '', user: '', from: '', host: 'smtp.yandex.ru', port: 465, enabled: false }; const { secret, ...rest } = cfg; return { ...rest, hasSecret: Boolean(secret) }; }
  function transport() { const cfg = getConfig('mail'); if (!cfg?.enabled || !cfg.to || !cfg.user || !cfg.secret) throw fail('Почта ещё не подключена. Заявки сохраняются в админке.'); return { cfg, sender: mailTransportFactory ? mailTransportFactory(cfg) : nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.port === 465, requireTLS: true, auth: { user: cfg.user, pass: decrypt(cfg.secret) }, connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 20000, disableFileAccess: true, disableUrlAccess: true }) }; }
  let delivering = false;
  async function deliver(id) {
    const row = db.prepare('SELECT * FROM enquiries WHERE id=?').get(id);
    if (!row || row.emailState === 'sent') return;
    const cfg = getConfig('mail');
    if (!cfg?.enabled || !cfg.to || !cfg.secret) { db.prepare("UPDATE enquiries SET emailState='not_configured' WHERE id=?").run(id); return; }
    // Claim before awaiting so repeated clicks and the background worker cannot send the same row concurrently.
    const claim = db.prepare("UPDATE enquiries SET emailState='sending',emailAttempts=emailAttempts+1 WHERE id=? AND emailState IN ('queued','failed','not_configured')").run(id);
    if (!claim.changes) return;
    try {
      const { sender } = transport();
      const result = await sender.sendMail({ from: { name: 'YOUKEY · заявки сайта', address: cfg.from || cfg.user }, to: cfg.to, subject: row.kind === 'feedback' ? 'YOUKEY — новое сообщение с сайта' : `YOUKEY — запись: ${row.groupLabel}`, text: `Новая ${row.kind === 'feedback' ? 'обратная связь' : 'заявка'}\n\nИмя: ${row.name}\nТелефон: ${row.phone}\nВозраст: ${row.age ?? 'не указан'}\nГруппа: ${row.groupLabel}\n${row.context}\n${row.message}\n\nID: ${row.id}\nДата: ${row.createdAt}`, messageId: `<${row.id}@youkey.local>` });
      if (!result.accepted?.length) throw new Error('Почтовый сервер не принял получателя.');
      db.prepare("UPDATE enquiries SET emailState='sent',emailError='',deliveryTo=? WHERE id=?").run(cfg.to, id);
    } catch (e) {
      const reason = e.code === 'EAUTH' ? 'Почтовый сервер отклонил авторизацию. Проверьте пароль приложения.' : e.code === 'ETIMEDOUT' || e.code === 'ESOCKET' ? 'Не удалось соединиться с почтовым сервером.' : 'Письмо не принято сервером. Проверьте подключение, адреса и повторите отправку.';
      db.prepare("UPDATE enquiries SET emailState='failed',emailError=?,nextAttempt=? WHERE id=?").run(reason, Date.now() + Math.min(3600000, 30000 * 2 ** row.emailAttempts), id);
    }
  }
  db.prepare("UPDATE enquiries SET emailState='queued' WHERE emailState='sending'").run();
  async function processQueue() { if (delivering) return; delivering = true; try { const cfg = getConfig('mail'); if (!cfg?.enabled) return; const rows = db.prepare("SELECT id FROM enquiries WHERE emailState IN ('queued','failed') AND emailAttempts < 5 AND nextAttempt <= ? ORDER BY createdAt LIMIT 3").all(Date.now()); for (const row of rows) await deliver(row.id); } finally { delivering = false; } }
  const timer = setInterval(() => { processQueue().catch(() => {}); }, 30000); timer.unref();
  async function body(req) { let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 300000) throw fail('Слишком большой запрос.', 413); } try { return JSON.parse(raw); } catch { throw fail('Некорректный JSON.'); } }
  function json(res, value, status = 200) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.end(JSON.stringify(value)); }
  async function middleware(req, res, next = () => { res.statusCode = 404; res.end('Not found'); }) {
    const path = (req.url || '').split('?')[0];
    if (path.startsWith('/uploads/')) {
      const match = /^\/uploads\/([a-f0-9-]+\.(jpg|png|webp))$/.exec(path);
      if (!['GET', 'HEAD'].includes(req.method) || !match || !existsSync(resolve(dataDir, 'uploads', match[1]))) { res.statusCode = 404; res.end(); return; }
      res.setHeader('Content-Type', { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[match[2]]); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (req.method === 'HEAD') res.end(); else createReadStream(resolve(dataDir, 'uploads', match[1])).on('error', () => res.destroy()).pipe(res); return;
    }
    if (!path.startsWith('/api/')) return next();
    try {
      const requestHost = new URL(`http://${req.headers.host || 'invalid'}`).hostname;
      if (localOnly && !loopback(requestHost)) throw fail('Недопустимый адрес запроса.', 403);
      if (!['GET', 'HEAD'].includes(req.method)) {
        const expected = publicOrigin || `http://${req.headers.host}`;
        if (req.headers.origin !== expected || req.headers['x-requested-with'] !== 'YOUKEY') throw fail('Недопустимый источник запроса.', 403);
      }
      if (path === '/api/site' && req.method === 'GET') { const site = getConfig('site'); return json(res, { ...site, groups: site.groups.filter(g => g.active !== false), delivery: { emailConfigured: Boolean(getConfig('mail')?.enabled), mode: localOnly ? 'local' : 'live' } }); }
      if (path === '/api/enquiries' && req.method === 'POST') {
        throttle(req, 'submit', 8); const data = await body(req);
        if (data.website) return json(res, { saved: true }, 201);
        if (data.kind === 'feedback') { if (typeof data.message !== 'string' || data.message.trim().length < 5 || data.message.length > 4000) throw fail('Сообщение должно содержать от 5 до 4000 символов.'); }
        const error = validateEnquiry({ ...data, age: data.kind === 'feedback' ? 18 : data.age, group: data.group || 'Подбор группы' }); if (error) throw fail(error);
        const site = getConfig('site'); let groupLabel = data.group || 'Подбор группы';
        if (data.groupId) { const g = site.groups.find(g => g.id === data.groupId && g.active !== false); if (!g) throw fail('Группа больше не доступна. Обновите расписание.'); const age = Number(data.age); if ((g.min !== null && age < g.min) || (g.max != null && age > g.max) || (!g.adult && age > 17)) throw fail('Возраст не соответствует выбранной группе.'); if (g.capacity != null && g.enrolled != null && g.enrolled >= g.capacity) throw fail('Свободных мест сейчас нет. Оставьте запрос на подбор другой группы.'); groupLabel = `${g.style} · ${g.days} · ${g.time}`; }
        const id = randomUUID(); const cfg = getConfig('mail'); const emailState = cfg?.enabled ? 'queued' : 'not_configured';
        db.prepare('INSERT INTO enquiries(id,createdAt,name,phone,age,groupId,groupLabel,context,kind,message,emailState) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id, new Date().toISOString(), data.name.trim(), data.phone.replace(/\D/g, '').replace(/^8/, '7'), data.kind === 'feedback' ? null : Number(data.age), data.groupId || null, groupLabel, String(data.context || '').slice(0, 400), data.kind === 'feedback' ? 'feedback' : 'booking', String(data.message || '').slice(0, 4000), emailState);
        json(res, { id, saved: true, emailState, mode: localOnly ? 'local' : 'live' }, 201); void processQueue(); return;
      }
      if (path === '/api/admin/session' && req.method === 'GET') return json(res, { authenticated: Boolean(sessions.read(req)), localSetup: localOnly && !getConfig('password'), passwordSet: Boolean(getConfig('password')) });
      if (path === '/api/admin/local-login' && req.method === 'POST') { if (!localOnly || getConfig('password')) throw fail('Войдите с паролем.', 403); sessions.create(res); return json(res, { authenticated: true }); }
      if (path === '/api/admin/login' && req.method === 'POST') { throttle(req, 'login', 5); const data = await body(req); const saved = getConfig('password'); if (typeof data.password !== 'string' || data.password.length > 200 || !saved) throw fail('Неверный пароль.', 401); const derived = scryptSync(data.password, saved.salt, 64); if (!timingSafeEqual(derived, Buffer.from(saved.hash, 'hex'))) throw fail('Неверный пароль.', 401); sessions.create(res); return json(res, { authenticated: true }); }
      if (!path.startsWith('/api/admin/') || !sessions.read(req)) throw fail('Войдите в админку.', 401);
      if (path === '/api/admin/upload' && req.method === 'POST') {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 8 * 1024 * 1024) throw fail('Максимальный размер фото — 8 МБ.', 413); chunks.push(chunk); }
        const file = Buffer.concat(chunks);
        const extension = file.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : file[0] === 255 && file[1] === 216 && file[2] === 255 ? 'jpg' : file.toString('ascii', 0, 4) === 'RIFF' && file.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : '';
        if (!extension) throw fail('Загрузите изображение JPEG, PNG или WebP.');
        mkdirSync(resolve(dataDir, 'uploads'), { recursive: true }); const filename = `${randomUUID()}.${extension}`;
        writeFileSync(resolve(dataDir, 'uploads', filename), file, { flag: 'wx' }); return json(res, { url: `/uploads/${filename}` }, 201);
      }
      if (path === '/api/admin/logout' && req.method === 'POST') { db.prepare('DELETE FROM sessions WHERE token=?').run(sessions.read(req)); res.setHeader('Set-Cookie', 'youkey_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, { ok: true }); }
      if (path === '/api/admin/password' && req.method === 'POST') { const data = await body(req); if (typeof data.password !== 'string' || data.password.length < 12 || data.password.length > 128) throw fail('Пароль должен содержать от 12 до 128 символов.'); const salt = randomBytes(24).toString('hex'); setConfig('password', { salt, hash: scryptSync(data.password, salt, 64).toString('hex') }); db.prepare('DELETE FROM sessions').run(); sessions.create(res); return json(res, { ok: true }); }
      if (path === '/api/admin/enquiries' && req.method === 'GET') return json(res, db.prepare('SELECT * FROM enquiries ORDER BY createdAt DESC LIMIT 2000').all());
      const record = /^\/api\/admin\/enquiries\/([a-f0-9-]+)(\/retry)?$/.exec(path);
      if (record) { const id = record[1]; if (!db.prepare('SELECT id FROM enquiries WHERE id=?').get(id)) throw fail('Заявка не найдена.', 404); if (record[2] && req.method === 'POST') { const cfg = getConfig('mail'); if (!cfg?.enabled) throw fail('Сначала подключите почту.'); db.prepare("UPDATE enquiries SET emailState='queued',emailAttempts=0,nextAttempt=0 WHERE id=? AND emailState NOT IN ('sent','sending')").run(id); await deliver(id); return json(res, db.prepare('SELECT * FROM enquiries WHERE id=?').get(id)); } if (req.method === 'PATCH') { const data = await body(req); if (!states.includes(data.status) || typeof data.notes !== 'string' || data.notes.length > 5000) throw fail('Проверьте статус и заметку.'); db.prepare('UPDATE enquiries SET status=?,notes=? WHERE id=?').run(data.status, data.notes, id); return json(res, { ok: true }); } }
      if (path === '/api/admin/site' && req.method === 'GET') return json(res, getConfig('site'));
      if (path === '/api/admin/site' && req.method === 'PUT') { const data = validateSite(await body(req)); const previous = getConfig('site'); setConfig('site-backup', previous); setConfig('site', data); return json(res, { ok: true }); }
      if (path === '/api/admin/site/restore' && req.method === 'POST') { const backup = getConfig('site-backup'); if (!backup) throw fail('Нет предыдущей версии.'); const current = getConfig('site'); setConfig('site', backup); setConfig('site-backup', current); return json(res, { ok: true }); }
      if (path === '/api/admin/mail' && req.method === 'GET') return json(res, safeMail());
      if (path === '/api/admin/mail' && req.method === 'PUT') { const data = await body(req); const previous = getConfig('mail'); if (data.to && !emailPattern.test(data.to)) throw fail('Проверьте адрес получателя.'); if (data.user && !emailPattern.test(data.user)) throw fail('Проверьте адрес отправителя.'); if (data.from && !emailPattern.test(data.from)) throw fail('Проверьте адрес отправителя.'); if (typeof data.host !== 'string' || !/^[a-zA-Z0-9.-]+$/.test(data.host) || ![465, 587].includes(Number(data.port))) throw fail('Нужен SMTP-сервер и защищённый порт 465 или 587.'); if (data.password && (typeof data.password !== 'string' || data.password.length > 500)) throw fail('Проверьте пароль приложения.'); const secret = data.password ? encrypt(data.password) : previous?.secret; if (data.enabled && (!data.to || !data.user || !secret)) throw fail('Укажите получателя, отправителя и пароль приложения.'); setConfig('mail', { to: data.to || '', host: data.host, port: Number(data.port), user: data.user || '', from: data.from || data.user || '', enabled: Boolean(data.enabled), secret }); return json(res, safeMail()); }
      if (path === '/api/admin/mail/test' && req.method === 'POST') { const { cfg, sender } = transport(); try { await sender.verify(); const info = await sender.sendMail({ from: { name: 'YOUKEY', address: cfg.from || cfg.user }, to: cfg.to, subject: 'YOUKEY — проверка доставки заявок', text: 'Подключение почты YOUKEY работает. Это тестовое письмо без данных клиентов.' }); if (!info.accepted?.length) throw new Error(); return json(res, { ok: true, message: 'Сервер принял тестовое письмо. Проверьте входящие и папку «Спам».' }); } catch { throw fail('Не удалось отправить тест. Проверьте SMTP, адреса и пароль приложения.', 502); } }
      if (path === '/api/admin/backup' && req.method === 'GET') { res.setHeader('Content-Disposition', 'attachment; filename="youkey-backup.json"'); return json(res, { exportedAt: new Date().toISOString(), site: getConfig('site'), enquiries: db.prepare('SELECT * FROM enquiries ORDER BY createdAt DESC').all() }); }
      throw fail('Действие не найдено.', 404);
    } catch (e) { return json(res, { error: e.status ? e.message : 'Ошибка сервера. Данные не изменены; попробуйте снова.' }, e.status || 500); }
  }
  return { middleware, processQueue, close() { clearInterval(timer); db.close(); }, db };
}
