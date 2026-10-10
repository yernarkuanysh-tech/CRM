import {useModal, useToast} from '../components/feedback';
import {FormFooter, Options, subtle} from '../components/ui';
import {currencies, feeLabels, statuses, validateFee} from '../lib/crm';
import {dateAt, iso, today} from '../lib/dates';
import {navigate} from '../route';
import {useCrm} from '../state';
import type {AppStatus, Application, Client} from '../types';
import {trimmedValues, useFormAction} from './common';

export function ApplicationForm({client, app: a}: {client: Client; app?: Application}) {
  const {updateClient} = useCrm();
  const modal = useModal(), toast = useToast();
  const {error, onSubmit} = useFormAction(async form => {
    const data = trimmedValues(form);
    if (!data.university || !data.program || !data.country) throw Error('Заполните университет, программу и страну.');
    const values = {university: data.university, program: data.program, country: data.country, deadline: data.deadline, status: data.status as AppStatus, ...validateFee(data)};
    const ok = await updateClient(client.id, draft => {
      const existing = draft.apps.find(x => x.id === a?.id);
      if (existing) Object.assign(existing, values);
      else draft.apps.push({id: crypto.randomUUID(), ...values});
    });
    if (!ok) return;
    modal.close();
    navigate(`client/${client.id}/applications`);
    toast('Сохранено в базе');
  });

  return (
    <form id="application-form" onSubmit={onSubmit}>
      <label>Университет<input name="university" required maxLength={160} defaultValue={a?.university || ''} placeholder="University of Toronto" /></label>
      <label>Программа<input name="program" required maxLength={160} defaultValue={a?.program || ''} placeholder="Computer Science" /></label>
      <div className="row">
        <label>Страна<input name="country" required maxLength={80} defaultValue={a?.country || ''} /></label>
        <label>Дедлайн<input name="deadline" type="date" required defaultValue={a?.deadline || dateAt(30)} /></label>
      </div>
      <label>Статус<select name="status" defaultValue={a?.status || statuses[0]}><Options items={statuses} /></select></label>
      <fieldset className="mx-0 mt-22 mb-0 rounded-[8px] border border-line p-15">
        <legend className="px-6 font-semibold">Application fee</legend>
        <p className={`${subtle} m-0 mb-15 leading-[1.6]`}>Укажите сумму сбора по этой заявке. В расходы попадут только оплаченные сборы.</p>
        <div className="row">
          <label>Сумма сбора<input name="feeAmount" type="number" min={0} max={10000000} step={0.01} defaultValue={a?.feeAmount ?? ''} placeholder="Например, 90.00" /></label>
          <label>Валюта<select name="feeCurrency" defaultValue={a?.feeCurrency || 'USD'}><Options items={currencies} /></select></label>
        </div>
        <label>Статус оплаты<select name="feeStatus" defaultValue={a?.feeStatus || 'unknown'}><Options items={Object.keys(feeLabels)} labels={feeLabels} /></select></label>
        <label>Дата оплаты (необязательно)<input name="feePaidDate" type="date" max={iso(today)} defaultValue={a?.feePaidDate || ''} /></label>
      </fieldset>
      <FormFooter label={a ? 'Сохранить' : 'Добавить заявку'} error={error} onCancel={modal.close} />
    </form>
  );
}
