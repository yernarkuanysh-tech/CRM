import {useModal, useToast} from '../components/feedback';
import {FormFooter} from '../components/ui';
import {dateAt} from '../lib/dates';
import {useCrm} from '../state';
import type {Client} from '../types';
import {trimmedValues, useFormAction} from './common';

export function TaskForm({client}: {client?: Client}) {
  const {clients, updateClient} = useCrm();
  const modal = useModal(), toast = useToast();
  const {error, onSubmit} = useFormAction(async form => {
    const data = trimmedValues(form);
    if (!data.title) throw Error('Опишите задачу.');
    if (!await updateClient(client?.id || data.client, draft => { draft.tasks.push({id: crypto.randomUUID(), title: data.title, date: data.date, done: false}); })) return;
    modal.close();
    toast('Сохранено в базе');
  });
  return (
    <form id="task-form" onSubmit={onSubmit}>
      {!client && <label>Клиент<select name="client">{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      <label>Что нужно сделать<input name="title" required maxLength={250} placeholder="Проверить мотивационное письмо" /></label>
      <label>Срок<input name="date" type="date" required defaultValue={dateAt(1)} /></label>
      <FormFooter label="Добавить задачу" error={error} onCancel={modal.close} />
    </form>
  );
}
