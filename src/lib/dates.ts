export const today = new Date();
today.setHours(0, 0, 0, 0);

export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const dateAt = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return iso(d);
};

export const fmt = (d?: string) => d ? new Date(d + 'T12:00:00').toLocaleDateString('ru-RU', {day: 'numeric', month: 'short'}) : 'Не указан';

export const days = (d?: string) => d ? Math.round((new Date(d + 'T00:00:00').getTime() - today.getTime()) / 86400000) : null;

export const fullDate = (value?: string) => value ? new Date(value + 'T12:00:00').toLocaleDateString('ru-RU') : 'Не указана';

export const isOverdue = (d?: string) => (days(d) ?? 0) < 0;
export const isToday = (d?: string) => days(d) === 0;
/** Due within a week, overdue included. Tasks without a date count as due. */
export const isDueSoon = (d?: string) => {
  const n = days(d);
  return n === null || n <= 7;
};
