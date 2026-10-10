import {useModal, useToast} from '../components/feedback';
import {FormFooter, Options} from '../components/ui';
import {exams, googleLink, levels, semesters} from '../lib/crm';
import {navigate} from '../route';
import {useCrm} from '../state';
import type {Client, Level} from '../types';
import {trimmedValues, useFormAction} from './common';

export function ClientForm({client: c}: {client?: Client}) {
  const {settings, clients, save} = useCrm();
  const modal = useModal(), toast = useToast();
  const {error, onSubmit} = useFormAction(async form => {
    const data = trimmedValues(form), digits = data.phone.replace(/\D/g, '');
    if (!data.name) throw Error('Укажите имя клиента.');
    if (data.folder && !googleLink(data.folder)) throw Error('Укажите HTTPS-ссылку на drive.google.com или docs.google.com.');
    if (data.phone && !/^\+?[\d\s()\-]+$/.test(data.phone)) throw Error('Используйте номер в международном формате, например +7 700 000 00 00.');
    if (data.phone && (digits.length < 10 || digits.length > 15)) throw Error('В номере должно быть от 10 до 15 цифр, включая код страны.');
    const values = {...data, name: data.name, level: data.level as Level, year: Number(data.year)};
    const existing = clients.find(x => x.id === c?.id);
    const target: Client = existing ? {...existing, ...values} : {id: crypto.randomUUID(), ...values, apps: [], docs: [], tasks: [], notes: '', demo: false};
    const next = existing ? clients.map(x => x.id === target.id ? target : x) : [target, ...clients];
    if (!await save(next)) return;
    modal.close();
    navigate(`client/${target.id}`);
    toast('Сохранено в базе');
  });

  return (
    <form id="client-form" onSubmit={onSubmit}>
      <label>ФИО клиента<input name="name" required maxLength={100} autoComplete="name" defaultValue={c?.name || ''} placeholder="Например, Амина Садыкова" /></label>
      <div className="row">
        <label>Уровень обучения<select name="level" defaultValue={c?.level || levels[0]}><Options items={levels} /></select></label>
        <label>Год поступления<input name="year" type="number" min={2020} max={2100} required defaultValue={c?.year || settings.year} /></label>
      </div>
      <label>Направление / поле<input name="academicField" maxLength={300} defaultValue={c?.academicField || ''} placeholder="IT / Business / Public Policy / Product Management" /></label>
      <label>Целевой семестр<select name="semester" defaultValue={c?.semester || 'Не указан'}><Options items={semesters} /></select></label>
      <label>Финансовая стратегия<input name="funding" maxLength={300} defaultValue={c?.funding || ''} placeholder="Fully Funded and Bolashak" /></label>
      <div className="row">
        <label>Уровень английского (текущий)<input name="english" maxLength={100} defaultValue={c?.english || ''} placeholder="Advanced" /></label>
        <label>Нужен GRE/GMAT?<select name="exam" defaultValue={c?.exam || 'Не уточнено'}><Options items={exams} /></select></label>
      </div>
      <label>Консультант GrantEd<input name="consultant" maxLength={160} defaultValue={c?.consultant || ''} placeholder="Yernar Kuanyshev" /></label>
      <label>Дата старта работы<input name="startDate" type="date" defaultValue={c?.startDate || ''} /></label>
      <label>Email<input name="email" type="email" autoComplete="email" defaultValue={c?.email || ''} placeholder="name@gmail.com" /></label>
      <label>Телефон для WhatsApp<input name="phone" type="tel" autoComplete="tel" defaultValue={c?.phone || ''} placeholder="+7 700 000 00 00" /></label>
      <label>Целевые страны<input name="country" maxLength={160} defaultValue={c?.country || ''} placeholder="Канада, Великобритания…" /></label>
      <label>Папка Google Drive<input name="folder" type="url" defaultValue={c?.folder || ''} placeholder="https://drive.google.com/drive/folders/…" /></label>
      <FormFooter label={c ? 'Сохранить изменения' : 'Добавить клиента'} error={error} onCancel={modal.close} />
    </form>
  );
}
