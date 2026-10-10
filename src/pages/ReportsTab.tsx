import {useRef, useState, type Ref} from 'react';
import {useModal, useToast} from '../components/feedback';
import {Badge, BtnRow, cx, Empty, EmptyTitle, errorText, Icon, localNote, Notice, SectionTop, subtle} from '../components/ui';
import {ReportEventForm, reportEventTitle, ReportForm} from '../forms/ReportForms';
import {errorMessage} from '../lib/api';
import {feeLabels, money} from '../lib/crm';
import {fmt, fullDate} from '../lib/dates';
import {makeImagePdf, renderReportCanvas} from '../lib/reportPdf';
import {reportCreatedDate, reportStatus, selectedReport, type ReportEventKind} from '../lib/reports';
import {useCrm} from '../state';
import type {Client, Report} from '../types';

const PAGE_HEIGHT = 1000;
const OVERFLOW_PRINT = 'Отчёт не помещается на одну страницу. Сформируйте новый с более коротким текстом или меньшим количеством подробных заявок.';
const OVERFLOW_PDF = 'Отчёт не помещается на одну страницу. Сократите текст или выберите меньше подробных заявок в новом отчёте.';

let lastReportPdfUrl: string | null = null;

export function ReportsTab({client: c}: {client: Client}) {
  const {selectedReportId, setSelectedReportId} = useCrm();
  const modal = useModal();
  const r = selectedReport(c, selectedReportId);
  return (
    <>
      <SectionTop>
        <div><h2>Отчёты для клиента</h2><p className={subtle}>По завершении этапа · 1 страница A4</p></div>
        <button className="primary" onClick={() => modal.open('Отчёт по завершении этапа', <ReportForm client={c} />)}><Icon name="plus" /> Создать отчёт</button>
      </SectionTop>
      <Notice>Сформируйте PDF и отправьте клиенту удобным способом. Отправка и ознакомление отмечаются вручную после фактического действия; автоматической рассылки нет.</Notice>
      {r ? (
        <>
          <div className="mb-12 flex gap-8 overflow-x-auto pb-16">
            {(c.reports || []).map(item => (
              <button key={item.id} className={cx('max-w-280 min-w-210 text-left whitespace-normal', r.id === item.id && 'border-ink bg-tint hover:border-[#cfcfcf]')} onClick={() => setSelectedReportId(item.id)}>
                <strong className="block text-[12px] font-[550]">{item.stage}</strong>
                <span className="mt-6 block text-[11px] leading-[1.5] text-muted">{`${fullDate(reportCreatedDate(item))} · ${reportStatus(item)}`}</span>
              </button>
            ))}
          </div>
          <ReportDetail key={r.id} client={c} report={r} />
        </>
      ) : (
        <Empty>
          <EmptyTitle>Первый отчёт по завершении этапа</EmptyTitle>
          В отчёте будут итоги, статусы заявок, расходы и следующие шаги.<br />Сначала внесите итоги этапа — CRM не определяет их автоматически.
        </Empty>
      )}
    </>
  );
}

function ReportDetail({client: c, report: r}: {client: Client; report: Report}) {
  const modal = useModal(), toast = useToast();
  const paper = useRef<HTMLElement>(null);
  const [fitError, setFitError] = useState('');
  const [download, setDownload] = useState<{url: string; name: string} | null>(null);
  const [busy, setBusy] = useState(false);

  const markEvent = (kind: ReportEventKind) => modal.open(reportEventTitle(kind), <ReportEventForm client={c} report={r} kind={kind} />);

  function print() {
    const element = paper.current;
    if (!element) return;
    if (element.querySelector('.report-inner')!.scrollHeight > PAGE_HEIGHT) {
      setFitError(OVERFLOW_PRINT);
      return;
    }
    setFitError('');
    const root = document.createElement('div');
    root.id = 'report-print-root';
    root.innerHTML = element.outerHTML;
    document.body.append(root);
    document.body.classList.add('printing-report');
    const cleanup = () => {
      document.body.classList.remove('printing-report');
      root.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  async function downloadPdf() {
    setBusy(true);
    try {
      await document.fonts.ready;
      const image = document.querySelector<HTMLImageElement>('.brand-logo-image');
      const logo = image?.complete && image.naturalWidth ? image : null;
      let output = renderReportCanvas(r, 10, {logo});
      if (!output.fits) output = renderReportCanvas(r, 9, {logo});
      if (!output.fits) throw new Error(OVERFLOW_PDF);
      const blob = await new Promise<Blob | null>(resolve => output.canvas.toBlob(resolve, 'image/jpeg', .97));
      if (!blob) throw new Error('Браузер не смог сформировать PDF. Попробуйте печать.');
      const bytes = makeImagePdf(new Uint8Array(await blob.arrayBuffer()), output.canvas.width, output.canvas.height);
      if (lastReportPdfUrl) URL.revokeObjectURL(lastReportPdfUrl);
      const url = URL.createObjectURL(new Blob([bytes], {type: 'application/pdf'}));
      const name = `GrantEd-report-${reportCreatedDate(r)}-${r.id.slice(0, 8)}.pdf`;
      lastReportPdfUrl = url;
      setDownload({url, name});
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      toast('PDF сформирован. Отправку клиенту отметьте отдельно.');
    } catch (error) {
      setFitError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-12 [&_button]:text-[12px]">
        <Badge tone={r.ack ? 'green' : r.sent ? 'blue' : 'neutral'}>{reportStatus(r)}</Badge>
        <BtnRow>
          <button className="primary" disabled={busy} onClick={downloadPdf}>Скачать PDF</button>
          <button onClick={print}>Печать</button>
          {!r.sent ? <button onClick={() => markEvent('sent')}>Отметить отправку</button>
            : !r.ack ? <button onClick={() => markEvent('ack')}>Подтвердить ознакомление</button> : null}
        </BtnRow>
      </div>
      {r.sent && <p className={subtle}>{`Отправка: ${fullDate(r.sent.date)} · ${r.sent.channel} · отмечено администратором.`}</p>}
      {r.ack && <p className={subtle}>{`Ознакомление: ${fullDate(r.ack.date)} · ${r.ack.channel} · ${r.ack.note}. Внесено администратором по ответу клиента.`}</p>}
      <p id="report-download" className={subtle} role="status">{download && <a href={download.url} download={download.name}>PDF готов — скачать файл</a>}</p>
      <p id="report-fit-error" className={errorText} role="alert">{fitError}</p>
      <div className="overflow-auto rounded-[8px] border border-line bg-tint p-20">
        <ReportPaper ref={paper} report={r} />
      </div>
      <p className={localNote}>Снимок на момент формирования. Внутренние заметки и контактные данные не включены. История хранится только в этом браузере.</p>
    </>
  );
}

export function ReportPaper({report: r, ref}: {report: Report; ref?: Ref<HTMLElement>}) {
  const created = fullDate(reportCreatedDate(r));
  const periodFees = r.periodFees.map(t => money(t.amount, t.currency)).join(' + ') || 'Нет оплат с датой в этом периоде';
  const allFees = r.fees.map(t => money(t.amount, t.currency)).join(' + ') || 'Оплаченные сборы не внесены';
  return (
    <article className="report-paper" id="report-paper" ref={ref}>
      <div className="report-inner">
        <header className="report-header">
          <strong>GrantEd<span>Сопровождение поступления</span></strong>
          <div>{r.demo ? 'ДЕМОНСТРАЦИОННЫЙ ОТЧЁТ' : 'ОТЧЁТ ПО ЭТАПУ'}<br /><span>{created}</span></div>
        </header>
        <h1>{r.client.name}</h1>
        <div className="report-subtitle">{`${r.client.level} · ${r.client.semester && r.client.semester !== 'Не указан' ? r.client.semester + ' ' : ''}${r.client.year}`}</div>
        <div className="report-stage"><h2>{r.stage}</h2><p>{`Период: ${fullDate(r.from)} — ${fullDate(r.to)}`}</p></div>
        <section className="report-section"><h2>01 / Итоги этапа</h2><p>{r.done}</p></section>
        <section className="report-section">
          <h2>02 / Заявки в университеты</h2>
          <p className="report-caption">{`На ${created}: Заявок: ${r.appCount} · отправлено: ${r.sentCount} · офферов: ${r.offerCount}`}</p>
          {r.applications.length ? (
            <table className="report-table">
              <thead><tr><th>Университет / программа</th><th>Статус</th><th>Дедлайн</th><th>Application fee</th></tr></thead>
              <tbody>
                {r.applications.map((a, i) => (
                  <tr key={i}>
                    <td>{a.university}<small>{a.program}</small></td>
                    <td>{a.status}</td>
                    <td>{fmt(a.deadline)}</td>
                    <td>
                      {a.feeStatus === 'paid' ? money(a.feeAmount ?? 0, a.feeCurrency) : a.feeStatus === 'waived' ? 'Waiver / без сбора' : a.feeAmount !== null ? money(a.feeAmount, a.feeCurrency) : 'Не указан'}
                      <small>{feeLabels[a.feeStatus] || 'Не указан'}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="report-caption">Подробные заявки в этот отчёт не включены.</p>}
          {r.appCount > r.applications.length && <p className="report-caption">{`Показано ${r.applications.length} из ${r.appCount} заявок. Общая сводка и расходы учитывают все заявки.`}</p>}
        </section>
        <section className="report-section report-fees">
          <h2>03 / Расходы клиента на application fee</h2>
          <p><b>За период:</b>{' ' + periodFees}<br /><b>Всего на дату отчёта:</b>{' ' + allFees}</p>
          {r.undatedPaid > 0 && <p className="report-caption">{`${r.undatedPaid} оплат без даты учтены только в общем итоге.`}</p>}
        </section>
        <section className="report-section"><h2>04 / Следующий этап</h2><p>{r.next}</p></section>
        <section className="report-action"><h2>Что нужно от вас</h2><p>{r.clientAction}</p></section>
        <footer className="report-footer"><span>{`Консультант: ${r.client.consultant || 'не указан'}`}</span><span>Пожалуйста, подтвердите ознакомление ответным сообщением.</span></footer>
      </div>
    </article>
  );
}
