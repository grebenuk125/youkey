export function filterGroups(groups, { age = '', day = 'all', style = 'all', adult = false } = {}) {
  return groups.filter(g => {
    if (Boolean(g.adult) !== adult) return false;
    if (style !== 'all' && g.style !== style) return false;
    if (day === 'weekend' && g.dayType !== 'weekend') return false;
    if (day === 'weekdays' && g.dayType !== 'weekdays') return false;
    if (day === 'early' && (g.dayType !== 'weekdays' || g.time >= '17:00')) return false;
    if (day === 'late' && (g.dayType !== 'weekdays' || g.time < '17:00')) return false;
    if (!age) return true;
    if (g.min === null) return false;
    const [lo, hi = lo] = String(age).split('-').map(Number);
    return g.min <= hi && (g.max ?? (adult ? 120 : 17)) >= lo;
  });
}
export function validateEnquiry(body) {
  if (!body || typeof body !== 'object') return 'Не удалось прочитать заявку.';
  if (typeof body.name !== 'string' || body.name.trim().length < 2 || body.name.length > 80) return 'Укажите имя: от 2 до 80 символов.';
  if (typeof body.phone !== 'string' || !/^(?:7|8)\d{10}$/.test(body.phone.replace(/\D/g, ''))) return 'Укажите российский номер телефона из 11 цифр.';
  if (!Number.isInteger(Number(body.age)) || Number(body.age) < 4 || Number(body.age) > 100) return 'Укажите возраст от 4 до 100 лет.';
  if (body.consent !== true) return 'Подтвердите согласие на локальное сохранение заявки.';
  if (typeof body.group !== 'string' || body.group.length > 200) return 'Проверьте выбранную группу.';
  return null;
}
