import {useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode} from 'react';
import {useModal, useToast} from '../components/feedback';
import {Shell} from '../components/Shell';
import {Avatar, Badge, BtnRow, card, cx, Empty, EmptyTitle, Heading, Icon, localNote, Options, Person, SectionTop, StatusBadge, subtle, TableWrap} from '../components/ui';
import {ApplicationForm} from '../forms/ApplicationForm';
import {ClientForm} from '../forms/ClientForm';
import {TaskForm} from '../forms/TaskForm';
import {TestForm} from '../forms/TestForm';
import {clientStatus, completed, feeLabels, feeTotals, initials, money, statuses, testScales} from '../lib/crm';
import {fmt, fullDate} from '../lib/dates';
import {deleteDocument, DOCUMENT_ACCEPT, downloadDocument, fileSize, listDocuments, uploadDocument} from '../lib/documents';
import {errorMessage} from '../lib/api';
import {navigate} from '../route';
import {useCrm} from '../state';
import type {AppStatus, Client, ClientDocument} from '../types';
import {ReportsTab} from './ReportsTab';
import {TaskRow} from './TasksPage';

const tabNames = ['overview', 'applications', 'tasks', 'reports', 'tests', 'documents', 'notes'] as const;
type Tab = typeof tabNames[number];

export function ClientPage({id, tab: requestedTab}: {id?: string; tab: string}) {
  const {clientById, user} = useCrm();
  const modal = useModal();
  const c = clientById(id);
  if (!c) {
    return <Shell><Empty><h1>Клиент не найден</h1><a href="#clients">Вернуться к списку</a></Empty></Shell>;
  }
  const tabs: [Tab, string, number | ''][] = [
    ['overview', 'Информация', ''],
    ['applications', 'Заявки', c.apps.length],
    ['tasks', 'Задачи', c.tasks.filter(t => !t.done).length],
    ['reports', 'Отчёты', (c.reports || []).length],
    ['tests', 'Тесты', (c.tests || []).length],
    ['documents', 'Документы', ''],
    ['notes', 'Заметки', ''],
  ];
  const tab: Tab = (tabNames as readonly string[]).includes(requestedTab) ? requestedTab as Tab : 'overview';
  const editClient = () => modal.open('Редактировать клиента', <ClientForm client={c} />);
  const openWhatsApp = () => {
    if (!c.phone) {
      modal.open('Добавьте номер телефона', <>
        <p>Чтобы открыть WhatsApp клиента, укажите его телефон в международном формате.</p>
        <div className="mt-23 flex justify-end gap-8"><button className="primary" onClick={editClient}>Добавить телефон</button></div>
      </>);
    } else {
      window.open('https://wa.me/' + c.phone.replace(/\D/g, ''), '_blank', 'noopener,noreferrer');
    }
  };
  const profile: [string, ReactNode][] = [
    ['Email', c.email || 'Не указан'],
    ['Телефон', c.phone || 'Не указан'],
    ['Страны', c.country || 'Не указаны'],
    ['Уровень', c.level],
    ['Год поступления', c.year],
    ['Университетов', new Set(c.apps.map(a => a.university.trim().toLowerCase())).size],
  ];
  const reportLayout = tab === 'reports';

  return (
    <Shell>
      <a className="mb-23 inline-flex items-center gap-7 text-[12px] text-muted" href="#clients"><Icon name="arrow" /> Все клиенты</a>
      <Heading title={c.name} text={`${c.level} · поступление ${c.year}`} avatar={<Avatar className="size-54 text-[18px] max-md:hidden">{initials(c.name)}</Avatar>}>
        <BtnRow>
          <button className="max-md:p-10 max-md:text-[12px]" onClick={openWhatsApp}><Icon name="mail" /> WhatsApp</button>
          <button className="max-md:p-10 max-md:text-[12px]" onClick={editClient}>Редактировать</button>
        </BtnRow>
      </Heading>
      <div className={cx('grid gap-28', reportLayout ? 'grid-cols-[minmax(0,1fr)]' : 'grid-cols-[245px_minmax(0,1fr)] max-xl:grid-cols-[215px_1fr] max-md:grid-cols-[1fr]')}>
        <aside className={cx('h-fit p-20 max-md:hidden', card, reportLayout && 'hidden')}>
          <h2 className="mb-24">О клиенте</h2>
          <dl>
            {profile.map(([label, value]) => (
              <div key={label} className="mb-22 last:mb-0">
                <dt className="mb-7 text-[11px] text-muted">{label}</dt>
                <dd className="m-0 text-[13px] wrap-anywhere">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-18 flex items-center gap-25 border-t border-line pt-17 text-[12px] text-muted max-md:flex-wrap max-md:gap-12"><StatusBadge status={clientStatus(c)} /></div>
          <p className={localNote}>{(c.demo ? 'Демонстрационный клиент. ' : '') + 'Данные сохраняются в базе.'}</p>
        </aside>
        <section>
          <nav className="mb-23 flex gap-8 overflow-auto border-b border-line pb-8 max-md:gap-4" aria-label="Разделы карточки">
            {tabs.map(([key, label, count]) => (
              <a
                key={key}
                href={`#client/${c.id}/${key}`}
                aria-current={tab === key ? 'page' : undefined}
                className={cx('rounded-full border px-13 py-7 text-[13px] whitespace-nowrap hover:no-underline max-md:px-11', tab === key ? 'border-ink border-b-2 bg-ink font-medium text-white' : 'border-transparent text-muted hover:bg-tint')}
              >
                {count !== '' ? <>{label + ' '}<span className={subtle}>{count}</span></> : label}
              </a>
            ))}
          </nav>
          {tab === 'overview' && <OverviewTab client={c} onEdit={editClient} canDelete={user.role === 'owner'} />}
          {tab === 'applications' && <ApplicationsTab client={c} />}
          {tab === 'tasks' && <TasksTab client={c} />}
          {tab === 'reports' && <ReportsTab client={c} />}
          {tab === 'tests' && <TestsSection client={c} />}
          {tab === 'documents' && <DocumentsTab key={c.id} client={c} />}
          {tab === 'notes' && <NotesTab key={c.id} client={c} />}
        </section>
      </div>
    </Shell>
  );
}

function OverviewTab({client: c, onEdit, canDelete}: {client: Client; onEdit(): void; canDelete: boolean}) {
  const modal = useModal();
  const fields: [string, string | undefined][] = [
    ['ФИО клиента', c.name],
    ['Направление / поле', c.academicField],
    ['Целевые страны', c.country],
    ['Целевой семестр / год', `${c.semester && c.semester !== 'Не указан' ? c.semester + ' · ' : ''}${c.year}`],
    ['Финансовая стратегия', c.funding],
    ['Уровень английского (текущий)', c.english],
    ['Нужен GRE/GMAT?', c.exam],
    ['Консультант GrantEd', c.consultant],
    ['Дата старта работы', fullDate(c.startDate)],
  ];
  const universities = [...new Set(c.apps.map(a => a.university))].join(', ');
  const row = 'grid grid-cols-[minmax(150px,40%)_minmax(0,1fr)] border-b border-line last:border-b-0 max-sm:grid-cols-[1fr]';
  const cell = 'm-0 px-16 py-14 text-[13px] leading-[1.6] wrap-anywhere';
  return (
    <>
      <SectionTop><h2>Информация о клиенте</h2><button onClick={onEdit}>Изменить данные</button></SectionTop>
      <dl className={cx('mx-0 mt-0 mb-24 overflow-hidden', card)}>
        {[...fields, ['Целевые университеты', null] as const].map(([label, value]) => (
          <div key={label} className={row}>
            <dt className={cx(cell, 'bg-white text-muted max-sm:pb-6')}>{label}</dt>
            <dd className={cx(cell, 'font-medium max-sm:pt-8')}>
              {value !== null ? value || 'Не указано' : <a className="text-link" href={`#client/${c.id}/applications`}>{c.apps.length ? universities : 'Добавить университеты в разделе «Заявки»'}</a>}
            </dd>
          </div>
        ))}
      </dl>
      <FeeSummary client={c} />
      <TestsSection client={c} />
      {canDelete && (
        <section className="mt-32 rounded-[8px] border border-[#f2b8b5] bg-[#fff8f7] p-18">
          <SectionTop margin="mb-0">
            <div>
              <h2 className="text-danger">Удаление абитуриента</h2>
              <p className="mt-6 mb-0 text-[12px] leading-[1.6] text-muted">Карточка, заявки, задачи, отчёты и документы будут удалены без возможности восстановления.</p>
            </div>
            <button className="border-[#e5484d] text-[#c62a2f] hover:bg-[#fff0ef]" onClick={() => modal.open('Удалить абитуриента', <DeleteClientForm client={c} />)}>Удалить</button>
          </SectionTop>
        </section>
      )}
    </>
  );
}

function DeleteClientForm({client}: {client: Client}) {
  const {deleteClient} = useCrm();
  const modal = useModal(), toast = useToast();
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const matches = confirmation.trim() === client.name.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!matches || deleting) return;
    setDeleting(true);
    setError('');
    try {
      const filesRemoved = await deleteClient(client.id);
      modal.close();
      navigate('clients');
      toast(filesRemoved ? `Абитуриент ${client.name} удалён` : `Карточка ${client.name} удалена, но часть файлов не удалось очистить`);
    } catch (caught) {
      setError(errorMessage(caught));
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <p>Это действие нельзя отменить. Для подтверждения введите имя абитуриента:</p>
      <p className="rounded-[6px] bg-tint px-12 py-9 font-medium text-ink">{client.name}</p>
      <label>
        Имя абитуриента
        <input autoFocus autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} aria-describedby="delete-client-error" />
      </label>
      <p id="delete-client-error" className="min-h-20 text-[12px] text-danger" role="alert">{error}</p>
      <div className="mt-23 flex justify-end gap-8">
        <button type="button" onClick={modal.close} disabled={deleting}>Отмена</button>
        <button type="submit" className="border-[#c62a2f] bg-[#c62a2f] text-white hover:border-[#a82429] hover:bg-[#a82429]" disabled={!matches || deleting}>{deleting ? 'Удаление…' : 'Удалить навсегда'}</button>
      </div>
    </form>
  );
}

function FeeSummary({client}: {client: Client}) {
  const totals = feeTotals(client.apps);
  return (
    <div className={cx('mb-22 p-18', card)}>
      <div>
        <h3>Расходы клиента · application fee</h3>
        <p className="mt-5 mb-14 text-[12px] leading-[1.6] text-muted">Только отмеченные как оплаченные. Валюты считаются отдельно.</p>
      </div>
      <div className="flex flex-wrap gap-12">
        {totals.length ? totals.map(t => <strong key={t.currency} className="text-[21px] font-semibold tabular-nums">{money(t.amount, t.currency)}</strong>) : <span className={subtle}>Оплаченные сборы не внесены</span>}
      </div>
    </div>
  );
}

function TestsSection({client: c}: {client: Client}) {
  const modal = useModal();
  const tests = c.tests || [];
  const open = (id?: string) => {
    const test = tests.find(t => t.id === id);
    modal.open(test ? 'Изменить результат' : 'Добавить результат', <TestForm client={c} test={test} />);
  };
  return (
    <>
      <SectionTop margin="mt-28 mb-17"><h2>Языковые тесты</h2><button onClick={() => open()}>Добавить результат</button></SectionTop>
      {tests.length ? (
        <TableWrap>
          <thead><tr><th>Тест / шкала</th><th>Результат</th><th>Дата сдачи</th><th></th></tr></thead>
          <tbody>
            {tests.map(t => (
              <tr key={t.id}>
                <td>{testScales[t.type]?.label || t.type}</td>
                <td><strong>{t.score}</strong></td>
                <td>{t.date ? fullDate(t.date) : 'Не указана'}</td>
                <td><button onClick={() => open(t.id)}>Изменить</button></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <p className={subtle}>Результатов пока нет. Можно добавить несколько тестов и пересдачи.</p>}
    </>
  );
}

const uniLogo = (name: string) => name.split(' ').filter(w => !['of', 'the'].includes(w)).slice(0, 2).map(w => w[0]).join('');

function ApplicationsTab({client: c}: {client: Client}) {
  const {updateClient} = useCrm();
  const modal = useModal(), toast = useToast();
  const setStatus = async (appId: string, status: AppStatus) => {
    if (await updateClient(c.id, draft => { draft.apps.find(a => a.id === appId)!.status = status; })) toast('Статус заявки сохранён');
  };
  return (
    <>
      <SectionTop>
        <div><h2>Заявки в университеты</h2><p className={subtle}>{`Отправлено ${completed(c)} из ${c.apps.length} · каждый статус можно изменить`}</p></div>
        <button onClick={() => modal.open('Добавить заявку', <ApplicationForm client={c} />)}><Icon name="plus" /> Заявка</button>
      </SectionTop>
      <FeeSummary client={c} />
      {c.apps.map(a => (
        <article key={a.id} className={cx('mb-13 p-19 motion-safe:animate-appear', card)}>
          <SectionTop margin="mb-15">
            <Person avatar={<span className="grid size-37 place-items-center rounded-[7px] border border-line bg-[#f1f4f9] font-[650] text-[#5d6e86]">{uniLogo(a.university)}</span>}>
              <h3>{a.university}</h3><span className={subtle}>{a.program}</span>
            </Person>
            <button className="px-9 py-6 text-[12px]" aria-label={`Изменить заявку ${a.university}`} onClick={() => modal.open('Редактировать заявку', <ApplicationForm client={c} app={a} />)}>Изменить</button>
          </SectionTop>
          <div className="flex flex-wrap items-center gap-24 text-[12px] text-muted max-md:gap-12">
            <span>{a.country}</span>
            <span><Icon name="calendar" />{` До ${fmt(a.deadline)}`}</span>
            <select key={a.status} className="ml-auto p-7 text-[12px] max-md:ml-0" aria-label={`Статус заявки ${a.university}`} defaultValue={a.status} onChange={e => setStatus(a.id, e.target.value as AppStatus)}>
              <Options items={statuses} />
            </select>
          </div>
          <div className="mt-16 flex flex-wrap items-center gap-12 border-t border-line pt-14 text-[12px] text-muted">
            <span>Application fee</span>
            <strong className="text-ink tabular-nums">{a.feeAmount === undefined || a.feeAmount === null ? 'Не указан' : money(a.feeAmount, a.feeCurrency || 'USD')}</strong>
            <Badge tone={a.feeStatus === 'paid' ? 'green' : 'neutral'}>{(a.feeStatus && feeLabels[a.feeStatus]) || 'Не указан'}</Badge>
            {a.feeStatus === 'paid' && a.feePaidDate && <span className={subtle}>{fullDate(a.feePaidDate)}</span>}
          </div>
        </article>
      ))}
      {!c.apps.length && <Empty><EmptyTitle>Заявок пока нет</EmptyTitle>Добавьте университет, программу и дедлайн.</Empty>}
    </>
  );
}


function TasksTab({client: c}: {client: Client}) {
  const modal = useModal();
  return (
    <>
      <SectionTop><h2>Задачи клиента</h2><button onClick={() => modal.open('Новая задача', <TaskForm client={c} />)}><Icon name="plus" /> Задача</button></SectionTop>
      {c.tasks.map(t => <TaskRow key={t.id} task={t} client={c} />)}
      {!c.tasks.length && <Empty>Задач пока нет. Добавьте следующий шаг по поступлению.</Empty>}
    </>
  );
}


function DocumentsTab({client: c}: {client: Client}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<ClientDocument[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = () => listDocuments(c.id).then(setDocs, e => setError(errorMessage(e)));
  useEffect(() => { reload(); }, [c.id]);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError('');
    try {
      await action();
      if (done) toast(done);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = [...event.target.files || []];
    event.target.value = '';
    if (!files.length) return;
    await run(async () => {
      for (const file of files) await uploadDocument(c.id, file);
    }, files.length > 1 ? `Загружено файлов: ${files.length}` : 'Документ загружен');
    await reload();
  }

  async function onDelete(doc: ClientDocument) {
    if (!window.confirm(`Удалить «${doc.name}»? Файл будет удалён без возможности восстановления.`)) return;
    await run(() => deleteDocument(doc), 'Документ удалён');
    await reload();
  }

  return (
    <>
      <SectionTop>
        <div><h2>Документы клиента</h2><p className={subtle}>PDF, сканы, фото, Word и Excel · до 20 МБ</p></div>
        <button disabled={busy} onClick={() => input.current?.click()}><Icon name="plus" /> {busy ? 'Загрузка…' : 'Загрузить'}</button>
        <input ref={input} type="file" multiple hidden accept={DOCUMENT_ACCEPT} onChange={onUpload} />
      </SectionTop>
      {error && <p className="mb-14 text-[12px] text-danger" role="alert">{error}</p>}
      {docs === null ? <p className={subtle}>Загрузка списка…</p> : docs.length ? (
        <TableWrap>
          <thead><tr><th>Файл</th><th>Размер</th><th>Загружен</th><th></th></tr></thead>
          <tbody>
            {docs.map(d => (
              <tr key={d.id}>
                <td className="wrap-anywhere"><Icon name="file" /> {d.name}</td>
                <td className="whitespace-nowrap">{fileSize(d.size)}</td>
                <td className="whitespace-nowrap">{new Date(d.createdAt).toLocaleDateString('ru-RU')}</td>
                <td>
                  <div className="flex justify-end gap-8">
                    <button disabled={busy} onClick={() => run(() => downloadDocument(d))}>Скачать</button>
                    <button disabled={busy} onClick={() => onDelete(d)}>Удалить</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : <Empty><EmptyTitle>Документов пока нет</EmptyTitle>Загрузите паспорт, транскрипт, сертификаты или письма.</Empty>}
    </>
  );
}

function NotesTab({client: c}: {client: Client}) {
  const {updateClient} = useCrm();
  const toast = useToast();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const notes = String(new FormData(event.currentTarget).get('notes')).trim();
    if (await updateClient(c.id, draft => { draft.notes = notes; })) toast('Заметка сохранена');
  }
  return (
    <>
      <SectionTop><h2>Внутренние заметки</h2><span className={subtle}>Только для администратора</span></SectionTop>
      <form id="notes-form" onSubmit={onSubmit}>
        <label htmlFor="notes">Договорённости, предпочтения и следующий шаг</label>
        <textarea id="notes" name="notes" className="min-h-180 w-full resize-y" maxLength={20000} placeholder="Что важно знать о клиенте…" defaultValue={c.notes} />
        <div className="mt-23 flex justify-end gap-8"><button className="primary" type="submit">Сохранить заметку</button></div>
      </form>
    </>
  );
}
