import {useState, type KeyboardEvent} from 'react';
import {useModal, useToast} from '../components/feedback';
import {FormFooter, Options, cx} from '../components/ui';
import {exams, googleDriveUrl, levels, normalizeClientTags, semesters, tagSuggestions} from '../lib/crm';
import {navigate} from '../route';
import {useCrm} from '../state';
import type {Client, Level} from '../types';
import {trimmedValues, useFormAction} from './common';

export function ClientForm({client: c}: {client?: Client}) {
  const {settings, clients, save} = useCrm();
  const modal = useModal(), toast = useToast();
  const [tags, setTags] = useState(() => normalizeClientTags(c?.tags || []));
  const [tagDraft, setTagDraft] = useState('');
  const {error, onSubmit} = useFormAction(async form => {
    const data = trimmedValues(form), digits = data.phone.replace(/\D/g, '');
    if (!data.name) throw Error('Укажите имя абитуриента.');
    if (data.phone && !/^\+?[\d\s()\-]+$/.test(data.phone)) throw Error('Используйте номер в международном формате, например +7 700 000 00 00.');
    if (data.phone && (digits.length < 10 || digits.length > 15)) throw Error('В номере должно быть от 10 до 15 цифр, включая код страны.');
    if (data.googleDriveUrl && !googleDriveUrl(data.googleDriveUrl)) throw Error('Укажите ссылку на Google Drive, начинающуюся с https://drive.google.com/.');
    const values = {...data, name: data.name, level: data.level as Level, year: Number(data.year), tags: normalizeClientTags([...tags, tagDraft])};
    const existing = clients.find(x => x.id === c?.id);
    const target: Client = existing ? {...existing, ...values} : {id: crypto.randomUUID(), ...values, apps: [], tasks: [], notes: '', demo: false};
    const next = existing ? clients.map(x => x.id === target.id ? target : x) : [target, ...clients];
    if (!await save(next)) return;
    modal.close();
    navigate(`client/${target.id}`);
    toast('Сохранено в базе');
  });

  return (
    <form id="client-form" onSubmit={onSubmit}>
      <label>ФИО абитуриента<input name="name" required maxLength={100} autoComplete="name" defaultValue={c?.name || ''} placeholder="Например, Амина Садыкова" /></label>
      <TagEditor tags={tags} setTags={setTags} draft={tagDraft} setDraft={setTagDraft} />
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
      <label>Email<input name="email" type="email" autoComplete="email" defaultValue={c?.email || ''} placeholder="name@example.com" /></label>
      <label>Телефон для WhatsApp<input name="phone" type="tel" autoComplete="tel" defaultValue={c?.phone || ''} placeholder="+7 700 000 00 00" /></label>
      <label>Папка Google Drive<input name="googleDriveUrl" type="url" maxLength={1000} defaultValue={c?.googleDriveUrl || ''} placeholder="https://drive.google.com/drive/folders/…" /></label>
      <label>Целевые страны<input name="country" maxLength={160} defaultValue={c?.country || ''} placeholder="Канада, Великобритания…" /></label>
      <FormFooter label={c ? 'Сохранить изменения' : 'Добавить абитуриента'} error={error} onCancel={modal.close} />
    </form>
  );
}

function TagEditor({tags, setTags, draft, setDraft}: {tags: string[]; setTags(value: string[]): void; draft: string; setDraft(value: string): void}) {
  const add = (value = draft) => {
    if (!value.trim() || tags.length >= 20) return;
    const next = normalizeClientTags([...tags, value]);
    setTags(next);
    setDraft('');
  };
  const remove = (tag: string) => setTags(tags.filter(value => value !== tag));
  const available = tagSuggestions.filter(suggestion => !tags.some(tag => tag.toLocaleLowerCase('ru-RU') === suggestion.toLocaleLowerCase('ru-RU')));
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      if (draft.trim()) add();
    } else if (event.key === 'Backspace' && !draft && tags.length) {
      remove(tags[tags.length - 1]);
    }
  };
  return (
    <fieldset className="mb-18 border-0 p-0">
      <legend className="mb-7 text-[12px] font-medium">Теги абитуриента</legend>
      <div className={cx('flex min-h-46 flex-wrap items-center gap-6 rounded-[12px] border border-[#0000001f] bg-white/90 p-6 shadow-[inset_0_1px_2px_#00000008]', !!tags.length && 'pb-7')}>
        {tags.map(tag => (
          <button key={tag} type="button" className="min-h-30 rounded-full border-[#d3e5ff] bg-[#e6f1ff] px-9 py-4 text-[11px] text-[#0761d1] shadow-none" onClick={() => remove(tag)} aria-label={`Удалить тег ${tag}`}>
            {tag}<span className="ml-6 text-[14px]" aria-hidden="true">×</span>
          </button>
        ))}
        <input className="min-h-32 min-w-150 flex-1 border-0 bg-transparent px-6 py-4 shadow-none focus:shadow-none" value={draft} maxLength={40} disabled={tags.length >= 20} onChange={event => setDraft(event.target.value.replace(',', ''))} onKeyDown={onKeyDown} onBlur={() => draft.trim() && add()} placeholder={tags.length >= 20 ? 'Достигнут лимит тегов' : tags.length ? 'Добавить ещё…' : 'Например, Bolashak'} aria-label="Новый тег" />
      </div>
      <p className="mt-7 mb-8 text-[11px] leading-[1.5] text-muted">Введите тег и нажмите Enter или запятую. До 20 тегов.</p>
      {!!available.length && tags.length < 20 && <div className="flex flex-wrap items-center gap-6" aria-label="Предлагаемые теги"><span className="mr-2 text-[11px] text-muted">Добавить:</span>{available.slice(0, 4).map(tag => <button key={tag} type="button" className="min-h-28 rounded-full border-line bg-white px-9 py-4 text-[11px] text-ink-soft shadow-none" onClick={() => add(tag)}>{tag}</button>)}</div>}
    </fieldset>
  );
}
