import {describe, expect, it} from 'vitest';
import {feeTotals, validateFee} from '../../src/lib/crm';
import {iso, today} from '../../src/lib/dates';
import {buildReport, recordReportEvent, reportStages, reportStatus} from '../../src/lib/reports';
import type {Application, Client} from '../../src/types';
import {seed} from './seed';

describe('application fees', () => {
  it('sums only paid fees, per currency, without float drift', () => {
    expect(feeTotals([
      {feeStatus: 'paid', feeAmount: 0.1, feeCurrency: 'USD'},
      {feeStatus: 'paid', feeAmount: 0.2, feeCurrency: 'USD'},
      {feeStatus: 'paid', feeAmount: 80, feeCurrency: 'EUR'},
      {feeStatus: 'unpaid', feeAmount: 100, feeCurrency: 'USD'},
      {feeStatus: 'waived', feeAmount: 50, feeCurrency: 'USD'},
      {},
    ])).toEqual([{currency: 'EUR', amount: 80}, {currency: 'USD', amount: 0.3}]);
  });

  it('rejects invalid amounts and dates', () => {
    for (const value of ['-1', '1.001', 'Infinity', 'abc']) expect(() => validateFee({feeStatus: 'paid', feeAmount: value, feeCurrency: 'USD'})).toThrow();
    expect(() => validateFee({feeStatus: 'paid', feeAmount: '', feeCurrency: 'USD'})).toThrow();
    expect(() => validateFee({feeStatus: 'paid', feeAmount: '90', feeCurrency: 'USD', feePaidDate: '2099-01-01'})).toThrow();
  });

  it('normalises waived and unknown fees', () => {
    expect(validateFee({feeStatus: 'waived', feeAmount: '90', feeCurrency: 'USD'}).feeAmount).toBe(0);
    expect(validateFee({feeStatus: 'unknown', feeAmount: '', feeCurrency: 'USD'}).feeAmount).toBe(null);
  });
});

describe('stage reports', () => {
  const client = (): Client => {
    const c = seed()[0];
    Object.assign(c.apps[0], {university: 'University of Toronto', program: 'CS', country: 'Canada', deadline: '2027-01-01', status: 'Подана'}, validateFee({feeAmount: '90.25', feeCurrency: 'USD', feeStatus: 'paid', feePaidDate: '2026-07-01'}));
    return c;
  };
  const input = {stage: reportStages[0], from: '2026-07-01', to: iso(today), done: 'Согласован список.', next: 'Подготовить документы.', clientAction: 'Уточнить приоритеты.', appIds: ['a0-0']};

  it('builds a snapshot without private data', () => {
    const report = buildReport(client(), input);
    expect(report.applications).toHaveLength(1);
    expect(report.appCount).toBe(2);
    expect(report.periodFees[0].amount).toBe(90.25);
    expect(report.sent).toBe(null);
    expect(report.ack).toBe(null);
    expect('notes' in report).toBe(false);
    expect('email' in report.client).toBe(false);
  });

  it('is not affected by later application changes', () => {
    const c = client();
    c.reports = [buildReport(c, input)];
    const app: Application = c.apps[0];
    app.status = 'Отказ';
    app.feeAmount = 200;
    expect(c.reports[0].applications[0].status).toBe('Подана');
    expect(c.reports[0].fees[0].amount).toBe(90.25);
  });

  it('records sent before acknowledgement, manually', () => {
    const c = client();
    const report = buildReport(c, input);
    c.reports = [report];
    expect(() => recordReportEvent(c, report.id, 'ack', {date: iso(today), channel: 'Email', note: 'Ответ клиента'})).toThrow();
    recordReportEvent(c, report.id, 'sent', {date: iso(today), channel: 'Email'});
    expect(() => recordReportEvent(c, report.id, 'ack', {date: iso(today), channel: 'Email', note: ''})).toThrow();
    recordReportEvent(c, report.id, 'ack', {date: iso(today), channel: 'Email', note: 'Получено подтверждение'});
    expect(c.reports[0].ack?.source).toBe('admin_manual');
    expect(reportStatus(c.reports[0])).toBe('Ознакомление подтверждено');
  });

  it('rejects impossible dates', () => {
    expect(() => buildReport(client(), {...input, from: '2026-02-31', appIds: []})).toThrow();
  });
});

describe('report paper', () => {
  // Imports src/lib/api.ts, which needs Supabase env vars that CI doesn't have.
  it.skipIf(process.env.CI)('renders escaped text and omits internal notes', async () => {
    const {renderToStaticMarkup} = await import('react-dom/server');
    const {createElement} = await import('react');
    const {ReportPaper} = await import('../../src/pages/ReportsTab');
    const c = seed()[0];
    c.notes = 'PRIVATE INTERNAL NOTE';
    const report = buildReport(c, {stage: reportStages[0], from: '2026-07-01', to: iso(today), done: '<script>bad()</script>', next: 'Далее.', clientAction: 'Действие.', appIds: []});
    const html = renderToStaticMarkup(createElement(ReportPaper, {report}));
    expect(html).not.toContain('PRIVATE INTERNAL NOTE');
    expect(html).toContain('&lt;script&gt;');
  });
});
