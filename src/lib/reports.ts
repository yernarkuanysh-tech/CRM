import type {Client, Report, ReportEvent} from '../types';
import {completed, feeTotals, reportDateValid} from './crm';
import {iso, today} from './dates';

export const reportStages = ['Стратегия и подбор университетов', 'Подготовка документов', 'Подача заявок', 'Интервью', 'Результаты и выбор оффера', 'Виза и подготовка к отъезду', 'Другой этап'];
export const reportChannels = ['WhatsApp', 'Email', 'Личная встреча', 'Звонок', 'Другой канал'];

export interface ReportInput {
  stage: string;
  from: string;
  to: string;
  done: string;
  next: string;
  clientAction: string;
  appIds: string[];
}

export interface ReportEventInput {
  date: string;
  channel: string;
  note?: string;
}

export type ReportEventKind = 'sent' | 'ack';

export const reportCreatedDate = (r: Report) => r.createdDate || r.createdAt.slice(0, 10);

export function reportDraft(c: Client) {
  const end = iso(today);
  return {stage: reportStages[0], from: c.startDate && c.startDate <= end ? c.startDate : end, to: end, appIds: c.apps.slice(0, 6).map(a => a.id)};
}

export function buildReport(c: Client, data: ReportInput): Report {
  if (!reportStages.includes(data.stage)) throw new Error('Выберите этап отчёта.');
  if (!reportDateValid(data.from) || !reportDateValid(data.to) || data.from > data.to || data.to > iso(today)) throw new Error('Проверьте период: начало не позже окончания, окончание не позже сегодня.');
  for (const [key, max, label] of [['done', 500, 'Итоги этапа'], ['next', 400, 'Следующий этап'], ['clientAction', 300, 'Что нужно от клиента']] as const) {
    const value = data[key];
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}: заполните поле, не более ${max} символов.`);
  }
  const selected = c.apps.filter(a => data.appIds.includes(a.id));
  if (selected.length > 8) throw new Error('Выберите не более 8 заявок для одностраничного отчёта. Остальные будут учтены в общей сводке.');
  const copy = JSON.parse(JSON.stringify({
    demo: !!c.demo,
    client: {name: c.name, level: c.level, year: c.year, semester: c.semester || '', consultant: c.consultant || ''},
    stage: data.stage,
    from: data.from,
    to: data.to,
    done: data.done.trim(),
    next: data.next.trim(),
    clientAction: data.clientAction.trim(),
    applications: selected.map(a => ({university: a.university, program: a.program, status: a.status, deadline: a.deadline, feeAmount: a.feeAmount ?? null, feeCurrency: a.feeCurrency || 'USD', feeStatus: a.feeStatus || 'unknown'})),
    appCount: c.apps.length,
    sentCount: completed(c),
    offerCount: c.apps.filter(a => a.status === 'Оффер').length,
    fees: feeTotals(c.apps),
    periodFees: feeTotals(c.apps.filter(a => a.feePaidDate && a.feePaidDate >= data.from && a.feePaidDate <= data.to)),
    undatedPaid: c.apps.filter(a => a.feeStatus === 'paid' && !a.feePaidDate).length,
  }));
  return {id: crypto.randomUUID(), ...copy, createdAt: new Date().toISOString(), createdDate: iso(new Date()), sent: null, ack: null};
}

export function selectedReport(c: Client, selectedId: string | null) {
  return (c.reports || []).find(r => r.id === selectedId) || (c.reports || [])[0];
}

export function reportStatus(r: Report) {
  return r.ack ? 'Ознакомление подтверждено' : r.sent ? 'Отправлен · ждём ответа' : 'Подготовлен';
}

/** Records a manual "sent" or "acknowledged" mark on the client's report (mutates `c`). */
export function recordReportEvent(c: Client, reportId: string, kind: string, data: ReportEventInput): ReportEvent {
  const report = (c.reports || []).find(r => r.id === reportId);
  if (!report) throw new Error('Отчёт не найден.');
  if (kind !== 'sent' && kind !== 'ack') throw new Error('Неизвестное действие.');
  if (kind === 'ack' && !report.sent) throw new Error('Сначала отметьте фактическую отправку.');
  if (report[kind]) throw new Error('Это действие уже отмечено.');
  const minDate = kind === 'ack' ? report.sent!.date : reportCreatedDate(report);
  if (!reportDateValid(data.date) || data.date < minDate || data.date > iso(today)) throw new Error('Дата должна быть не раньше предыдущего действия и не позже сегодня.');
  if (!reportChannels.includes(data.channel)) throw new Error('Выберите канал.');
  if (kind === 'ack' && !data.note?.trim()) throw new Error('Укажите, как клиент подтвердил ознакомление.');
  const value = {date: data.date, channel: data.channel, note: (data.note || '').trim(), recordedAt: new Date().toISOString(), source: 'admin_manual'};
  report[kind] = value;
  return value;
}
