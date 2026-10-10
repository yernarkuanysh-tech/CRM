import {useModal, useToast} from '../components/feedback';
import {FormFooter, Options, subtle} from '../components/ui';
import {iso, today} from '../lib/dates';
import {buildReport, recordReportEvent, reportChannels, reportCreatedDate, reportDraft, reportStages, type ReportEventKind} from '../lib/reports';
import {useCrm} from '../state';
import type {Client, Report} from '../types';
import {rawValues, useFormAction} from './common';

export function ReportForm({client: c}: {client: Client}) {
  const {updateClient, setSelectedReportId} = useCrm();
  const modal = useModal(), toast = useToast();
  const draft = reportDraft(c);
  const {error, onSubmit} = useFormAction(async form => {
    const data = rawValues(form);
    const report = buildReport(c, {stage: data.stage, from: data.from, to: data.to, done: data.done, next: data.next, clientAction: data.clientAction, appIds: new FormData(form).getAll('application').map(String)});
    if (!await updateClient(c.id, client => { client.reports = [report, ...(client.reports || [])]; })) return;
    setSelectedReportId(report.id);
    modal.close();
    toast('Сохранено в истории отчётов');
  });
  return (
    <form id="report-form" onSubmit={onSubmit}>
      <label>Завершённый этап<select name="stage" defaultValue={draft.stage}><Options items={reportStages} /></select></label>
      <div className="row">
        <label>Начало периода<input name="from" type="date" required max={iso(today)} defaultValue={draft.from} /></label>
        <label>Конец периода<input name="to" type="date" required max={iso(today)} defaultValue={draft.to} /></label>
      </div>
      <label>Итоги этапа · до 500 символов<textarea name="done" rows={4} required maxLength={500} placeholder="Какая работа выполнена и какого результата достигли…" /></label>
      <label>Следующий этап · до 400 символов<textarea name="next" rows={3} required maxLength={400} placeholder="Что будет сделано дальше и в какие сроки…" /></label>
      <label>Что нужно от клиента · до 300 символов<textarea name="clientAction" rows={3} required maxLength={300} placeholder="Действия клиента и сроки, либо «Дополнительных действий не требуется»…" /></label>
      <fieldset className="rounded-[8px] border border-line bg-white p-14 shadow-card">
        <legend>Заявки в отчёте · до 8</legend>
        <p className={subtle}>Сводка и расходы учтут все заявки. Выберите те, которые важно показать подробно.</p>
        {c.apps.map(a => (
          <label key={a.id} className="flex items-center gap-9 text-[12px] leading-[1.5] font-normal">
            <input className="m-0 inline-block w-16 shrink-0" type="checkbox" name="application" value={a.id} defaultChecked={draft.appIds.includes(a.id)} />{`${a.university} · ${a.program}`}
          </label>
        ))}
        {!c.apps.length && <p className={subtle}>Заявок пока нет.</p>}
      </fieldset>
      <p className={subtle}>В отчёт попадут текущие статусы, а не исторические статусы за прошлый период. Перед отправкой проверьте PDF.</p>
      <FormFooter label="Сформировать отчёт" error={error} onCancel={modal.close} />
    </form>
  );
}

export function ReportEventForm({client: c, report: r, kind}: {client: Client; report: Report; kind: ReportEventKind}) {
  const {updateClient} = useCrm();
  const modal = useModal(), toast = useToast();
  const {error, onSubmit} = useFormAction(async form => {
    const data = rawValues(form);
    if (!await updateClient(c.id, client => { recordReportEvent(client, r.id, kind, {date: data.date, channel: data.channel, note: data.note}); })) return;
    modal.close();
    toast('Сохранено в истории отчётов');
  });
  return (
    <form id="report-event-form" onSubmit={onSubmit}>
      <p>{kind === 'sent' ? 'Отметьте только уже отправленный клиенту отчёт. Эта кнопка не отправляет сообщения.' : 'Внесите подтверждение, которое вы уже получили от клиента. Открытие PDF само по себе не означает ознакомления.'}</p>
      <label>Дата<input type="date" name="date" required min={kind === 'ack' ? r.sent?.date : reportCreatedDate(r)} max={iso(today)} defaultValue={iso(today)} /></label>
      <label>Канал<select name="channel"><Options items={reportChannels} /></select></label>
      {kind === 'ack' && <label>Подтверждение клиента<textarea name="note" required maxLength={250} rows={3} placeholder="Например: ответил «Ознакомился, всё понятно» в WhatsApp" /></label>}
      <FormFooter label={kind === 'sent' ? 'Отправка состоялась' : 'Подтверждение получено'} error={error} onCancel={modal.close} />
    </form>
  );
}

export const reportEventTitle = (kind: ReportEventKind) => kind === 'sent' ? 'Отметить фактическую отправку' : 'Подтвердить ознакомление';
