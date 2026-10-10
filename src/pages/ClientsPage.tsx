import {useModal} from '../components/feedback';
import {Shell} from '../components/Shell';
import {Avatar, BtnRow, cx, Empty, Heading, Icon, localNote, Options, Person, PersonSmall, quietLink, SectionTop, StatusBadge, subtle, TableWrap, type IconName} from '../components/ui';
import {ClientForm} from '../forms/ClientForm';
import {allTasks, clientStages, clientStatus, completed, initials, isSent, levels} from '../lib/crm';
import {days, fmt, isDueSoon} from '../lib/dates';
import {useCrm} from '../state';

const PAGE_SIZE = 10;

export function ClientsPage() {
  const {clients, settings} = useCrm();
  const modal = useModal();
  const deadlines = allTasks(clients).filter(t => !t.done).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
  return (
    <Shell active="clients">
      <Heading title="Клиенты" text="Все поступления — в одном рабочем пространстве.">
        <button className="primary" onClick={() => modal.open('Новый клиент', <ClientForm />)}><Icon name="plus" /> Добавить клиента</button>
      </Heading>
      <Stats />
      <div className="grid grid-cols-[minmax(0,1fr)_270px] gap-32 max-xl:grid-cols-[1fr]">
        <section>
          <SectionTop>
            <h2>База клиентов <span className={cx(subtle, 'ml-6')}>{clients.length}</span></h2>
            <span className={subtle}>{`Набор ${settings.year}`}</span>
          </SectionTop>
          <ClientTable />
          <p className={localNote}>Изменения сохраняются в базе данных. Документы открываются по вашим ссылкам Google Drive.</p>
        </section>
        <aside className="border-l border-line pl-24 max-xl:hidden">
          <h2 className="mt-2 mb-7">Требуют внимания</h2>
          <span className={subtle}>Ближайшие задачи</span>
          {deadlines.map(t => {
            const n = days(t.date) ?? 0;
            return (
              <div key={t.client.id + t.id} className="border-b border-line py-18">
                <span className={cx('text-[11px] tracking-[.02em]', n < 0 ? 'text-danger' : 'text-warning')}>{(n < 0 ? 'Просрочено · ' : n === 0 ? 'Сегодня · ' : '') + fmt(t.date)}</span>
                <a className="mt-8 mb-5 block text-[13px] font-[550] text-ink" href={`#client/${t.client.id}/tasks`}>{t.client.name}</a>
                <p className="m-0 text-[12px] leading-[1.5] text-muted">{t.title}</p>
              </div>
            );
          })}
          <a className={quietLink} href="#tasks">Все задачи</a>
          <div className="mt-28 rounded-[9px] border border-line bg-canvas p-16 text-ink-soft">
            <Icon name="link" /> <strong className="ml-4 text-[12px]">Документы рядом</strong>
            <p className="mb-0 text-[12px] leading-[1.6] text-muted">Добавьте ссылку на папку Google Drive в карточке клиента.</p>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Stats() {
  const {clients} = useCrm();
  const apps = clients.flatMap(c => c.apps);
  const stats: [string, number, string, IconName][] = [
    ['Всего клиентов', clients.length, 'в текущем рабочем пространстве', 'people'],
    ['Заявок отправлено', apps.filter(isSent).length, `из ${apps.length} заявок`, 'file'],
    ['Получено офферов', apps.filter(a => a.status === 'Оффер').length, 'результаты по университетам', 'hat'],
    ['Задачи на 7 дней', allTasks(clients).filter(t => !t.done && isDueSoon(t.date)).length, 'включая просроченные', 'clock'],
  ];
  return (
    <div className="mb-28 grid grid-cols-[repeat(4,1fr)] overflow-hidden rounded-[8px] border border-line bg-white shadow-stats max-md:grid-cols-[1fr_1fr]">
      {stats.map(([label, number, caption, icon], i) => (
        <div key={label} className={cx('relative px-23 py-20 max-md:p-17', i > 0 && 'border-l border-line', i === 2 && 'max-md:border-t max-md:border-l-0', i === 3 && 'max-md:border-t')}>
          <div className="text-[12px] tracking-[.015em] text-muted">{label}</div>
          <Icon name={icon} className="absolute top-20 right-22 text-faint max-md:top-15 max-md:right-16" />
          <div className="mt-10 mb-6 text-[30px] font-semibold tracking-[-.035em] text-ink tabular-nums max-md:text-[26px]">{number}</div>
          <small className="text-[11px] tracking-[.015em] text-muted">{caption}</small>
        </div>
      ))}
    </div>
  );
}

function ClientTable() {
  const {clients, list, setList} = useCrm();
  const {query, level, stage} = list;
  const found = clients.filter(c =>
    (!query || `${c.name} ${c.email} ${c.apps.map(a => a.university).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
    && (!level || c.level === level)
    && (!stage || clientStatus(c) === stage));
  const pages = Math.max(1, Math.ceil(found.length / PAGE_SIZE));
  const page = Math.min(list.page, pages);
  const rows = found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const filter = (patch: Partial<typeof list>) => setList({...list, ...patch, page: 1});

  return (
    <>
      <div className="mb-17 flex flex-wrap gap-9">
        <div className="relative min-w-190 flex-1">
          <Icon name="search" className="absolute top-11 left-11 text-muted" />
          <input className="w-full pl-37" aria-label="Поиск клиентов" placeholder="Имя, почта или университет…" value={query} onChange={e => filter({query: e.target.value})} />
        </div>
        <select className="max-md:flex-1" aria-label="Уровень обучения" value={level} onChange={e => filter({level: e.target.value})}>
          <option value="">Все уровни</option>
          <Options items={levels} />
        </select>
        <select className="max-md:flex-1" aria-label="Статус клиента" value={stage} onChange={e => filter({stage: e.target.value})}>
          <option value="">Все статусы</option>
          <Options items={clientStages} />
        </select>
      </div>
      <TableWrap>
        <thead><tr><th>Клиент</th><th>Обучение</th><th>Заявки</th><th>Статус</th><th>Дедлайн</th></tr></thead>
        <tbody>
          {rows.map((c, i) => {
            const sent = completed(c);
            const nextDeadline = c.apps.filter(a => !['Оффер', 'Отказ'].includes(a.status)).sort((a, b) => a.deadline.localeCompare(b.deadline))[0]?.deadline;
            return (
              <tr key={c.id}>
                <td>
                  <Person avatar={<Avatar tone={i}>{initials(c.name)}</Avatar>}>
                    <a className="text-[13px] font-medium text-ink hover:text-link" href={`#client/${c.id}`}>{c.name}</a>
                    <PersonSmall>{c.email || 'Почта не указана'}</PersonSmall>
                  </Person>
                </td>
                <td>{c.level}<br /><span className={subtle}>{c.year}</span></td>
                <td>
                  {`${sent} из ${c.apps.length}`}
                  <div className="mt-7 h-4 w-70 overflow-hidden rounded-[4px] bg-line" aria-label={`${sent} из ${c.apps.length} заявок отправлено`}>
                    <span className="block h-full bg-ink" style={{width: `${c.apps.length ? sent / c.apps.length * 100 : 0}%`}} />
                  </div>
                </td>
                <td><StatusBadge status={clientStatus(c)} /></td>
                <td>{fmt(nextDeadline)}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={5}><Empty>Клиенты не найдены. Попробуйте изменить поиск или фильтры.</Empty></td></tr>}
        </tbody>
      </TableWrap>
      <div className="flex items-center justify-between py-16 text-[12px] text-muted">
        <span>{`${found.length ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, found.length)}` : '0'} из ${found.length} клиентов`}</span>
        <BtnRow>
          <button className="px-11 py-7" disabled={page === 1} aria-label="Предыдущая страница" onClick={() => setList({...list, page: page - 1})}>‹</button>
          <span>{`${page} / ${pages}`}</span>
          <button className="px-11 py-7" disabled={page === pages} aria-label="Следующая страница" onClick={() => setList({...list, page: page + 1})}>›</button>
        </BtnRow>
      </div>
    </>
  );
}
