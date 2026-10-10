import {useModal, useToast} from '../components/feedback';
import {FormFooter, Options} from '../components/ui';
import {documentTypes, googleLink} from '../lib/crm';
import {navigate} from '../route';
import {useCrm} from '../state';
import type {Client} from '../types';
import {trimmedValues, useFormAction} from './common';

export function DocumentForm({client}: {client: Client}) {
  const {updateClient} = useCrm();
  const modal = useModal(), toast = useToast();
  const {error, onSubmit} = useFormAction(async form => {
    const data = trimmedValues(form);
    if (!data.name) throw Error('Введите название документа.');
    if (!googleLink(data.url)) throw Error('Поддерживаются HTTPS-ссылки на drive.google.com и docs.google.com.');
    if (!await updateClient(client.id, draft => { draft.docs.push({id: crypto.randomUUID(), name: data.name, type: data.type, url: googleLink(data.url)}); })) return;
    modal.close();
    navigate(`client/${client.id}/documents`);
    toast('Сохранено в базе');
  });
  return (
    <form id="document-form" onSubmit={onSubmit}>
      <label>Название<input name="name" required maxLength={160} placeholder="Резюме · английская версия" /></label>
      <label>Тип документа<select name="type"><Options items={documentTypes} /></select></label>
      <label>Ссылка Google Drive или Docs<input name="url" type="url" required placeholder="https://docs.google.com/document/d/…" /></label>
      <FormFooter label="Добавить ссылку" error={error} onCancel={modal.close} />
    </form>
  );
}
