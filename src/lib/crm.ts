import type {AppStatus, Application, Client, Currency, FeeStatus, FeeTotal, Level, Task, TestType} from '../types';
import {iso, today} from './dates';

export const levels: Level[] = ['Бакалавриат', 'Магистратура', 'PhD'];
export const statuses: AppStatus[] = ['Подбор программы', 'Документы', 'Подана', 'Интервью', 'Оффер', 'Отказ'];
export const clientStages: AppStatus[] = ['Документы', 'Подана', 'Интервью', 'Оффер'];
export const currencies: Currency[] = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'KZT'];
export const feeLabels: Record<FeeStatus, string> = {unknown: 'Не указан', unpaid: 'Не оплачен', paid: 'Оплачен клиентом', waived: 'Без сбора / waiver'};
export const semesters = ['Не указан', 'Fall', 'Spring', 'Summer', 'Winter'];
export const exams = ['Не уточнено', 'Нет', 'GRE', 'GMAT', 'GRE или GMAT', 'GRE и GMAT'];
export const documentTypes = ['Резюме', 'Мотивационное письмо', 'Рекомендация', 'Фото', 'Диплом / транскрипт', 'Другой документ'];
export const PROTOTYPE_KEY = 'admissions-crm-demo-v1';

export const testScales: Record<TestType, {min: number; max: number; step: number; label: string}> = {
  'IELTS': {min: 0, max: 9, step: .5, label: 'IELTS · 0–9'},
  'TOEFL': {min: 1, max: 6, step: .5, label: 'TOEFL iBT · 1–6'},
  'TOEFL-120': {min: 0, max: 120, step: 1, label: 'TOEFL iBT · 0–120'},
  'DET': {min: 10, max: 160, step: 5, label: 'DET · 10–160'},
};

const sentStatuses: AppStatus[] = ['Подана', 'Интервью', 'Оффер', 'Отказ'];

export const isSent = (a: Application) => sentStatuses.includes(a.status);

export const clientStatus = (c: Client): AppStatus =>
  c.apps.some(a => a.status === 'Оффер') ? 'Оффер'
  : c.apps.some(a => a.status === 'Интервью') ? 'Интервью'
  : c.apps.some(a => a.status === 'Подана') ? 'Подана'
  : 'Документы';

export const completed = (c: Client) => c.apps.filter(isSent).length;

export type TaskWithClient = Task & {client: Client};

export const allTasks = (clients: Client[]): TaskWithClient[] => clients.flatMap(c => c.tasks.map(t => ({...t, client: c})));

export const initials = (name: string, separator: string | RegExp = ' ') => name.split(separator).map(v => v[0]).slice(0, 2).join('');

export function googleLink(value?: string) {
  try {
    const u = new URL(value ?? '');
    return u.protocol === 'https:' && ['drive.google.com', 'docs.google.com'].includes(u.hostname) ? u.href : '';
  } catch {
    return '';
  }
}

export function money(amount: number, currency: string) {
  return new Intl.NumberFormat('ru-RU', {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(amount) + ' ' + currency;
}

export interface FeeInput {
  feeAmount?: string | number | null;
  feeCurrency?: string;
  feeStatus?: string;
  feePaidDate?: string;
}

export function validateFee(data: FeeInput) {
  const status = data.feeStatus || 'unknown', currency = data.feeCurrency || 'USD';
  if (!Object.hasOwn(feeLabels, status) || !currencies.includes(currency as Currency)) throw new Error('Выберите статус оплаты и валюту из списка.');
  let amount = data.feeAmount === '' || data.feeAmount == null ? null : Number(data.feeAmount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 10000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001)) throw new Error('Укажите неотрицательную сумму с максимум двумя знаками после запятой.');
  if (status === 'paid' && amount === null) throw new Error('Укажите сумму, которую оплатил клиент.');
  if (status === 'waived') amount = 0;
  const paidDate = status === 'paid' ? (data.feePaidDate || '') : '';
  if (paidDate && (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate) || !Number.isFinite(Date.parse(paidDate)) || paidDate > iso(today))) throw new Error('Дата оплаты должна быть корректной и не позже сегодняшнего дня.');
  return {feeAmount: amount, feeCurrency: currency as Currency, feeStatus: status as FeeStatus, feePaidDate: paidDate};
}

export function feeTotals(apps: Partial<Application>[]): FeeTotal[] {
  const totals: Record<string, number> = {};
  for (const a of apps) {
    if (a.feeStatus === 'paid' && typeof a.feeAmount === 'number' && Number.isFinite(a.feeAmount) && a.feeAmount >= 0) {
      const currency = a.feeCurrency || 'USD';
      totals[currency] = (totals[currency] || 0) + Math.round(a.feeAmount * 100);
    }
  }
  return Object.entries(totals).sort(([a], [b]) => a.localeCompare(b)).map(([currency, cents]) => ({currency, amount: cents / 100}));
}

export function validateTestScore(type: string, rawScore: string, date: string) {
  const scale = testScales[type as TestType], score = Number(rawScore);
  if (!scale || rawScore === '' || !Number.isFinite(score) || score < scale.min || score > scale.max || !Number.isInteger((score - scale.min) / scale.step)) throw new Error('Проверьте балл и выбранную шкалу.');
  if (date && (!reportDateValid(date) || date > iso(new Date()))) throw new Error('Укажите корректную дату не позже сегодня.');
  return score;
}

export function reportDateValid(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
}
