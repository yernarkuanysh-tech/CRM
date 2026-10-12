import type {ReactNode} from 'react';
import {check, downloadExport, errorMessage, supabase} from '../lib/api';
import {allTasks, initials, PROTOTYPE_KEY} from '../lib/crm';
import {isDueSoon, today} from '../lib/dates';
import {useCrm} from '../state';
import type {Client} from '../types';
import {useModal, useToast} from './feedback';
import {Avatar, BrandLogo, cx, Icon, quietLink, type IconName} from './ui';

export type Section = 'clients' | 'tasks' | 'integrations' | 'settings';

const pageNames: Record<Section, string> = {clients: 'Абитуриенты', tasks: 'Задачи', settings: 'Настройки', integrations: 'Интеграции'};

export function Shell({active = 'clients', children}: {active?: Section; children: ReactNode}) {
  const {user, settings, clients, signOut} = useCrm();
  const toast = useToast();
  const owner = user.role === 'owner';
  const navigation: [Section, IconName, string, number | ''][] = [
    ['clients', 'people', 'Абитуриенты', clients.length],
    ['tasks', 'calendar', 'Задачи', allTasks(clients).filter(task => !task.done && isDueSoon(task.date)).length],
    ['integrations', 'link', 'Интеграции', ''],
    ['settings', 'grid', 'Настройки', ''],
  ];

  async function logout() {
    try {
      check(await supabase.auth.signOut({scope: 'local'}));
      signOut();
    } catch (error) {
      toast(errorMessage(error));
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-[248px_minmax(0,1fr)] gap-12 p-12 max-xl:grid-cols-[220px_1fr] max-md:block max-md:p-0">
      <aside className="glass sticky top-12 flex h-[calc(100vh-24px)] flex-col rounded-[22px] px-14 pt-18 pb-14 max-md:static max-md:h-auto max-md:rounded-none max-md:border-x-0 max-md:border-t-0 max-md:px-12 max-md:py-10">
        <a href="#clients" className="flex items-center gap-10 px-8 pb-25 text-[17px] font-[650] tracking-[-.025em] text-ink max-xl:text-[15px]" aria-label={`${settings.organization || 'GrantEd'} — главная`}>
          <BrandLogo organization={settings.organization} />
        </a>
        <p className="mx-12 mt-0 mb-10 text-[10px] font-[650] tracking-[.08em] text-faint uppercase max-md:hidden">Рабочее пространство</p>
        <nav className="flex flex-col gap-2 max-md:flex-row max-md:overflow-auto" aria-label="Основное меню">
          {navigation.map(([id, icon, label, count]) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={active === id ? 'page' : undefined}
              className={cx(
                'relative flex items-center gap-11 rounded-[12px] px-12 py-10 text-[14px] font-medium hover:no-underline max-md:whitespace-nowrap',
                active === id ? 'bg-white text-ink shadow-[inset_0_1px_0_#fff,0_1px_3px_#00000012,0_7px_16px_#0000000a] before:absolute before:left-[-4px] before:h-18 before:w-3 before:rounded-full before:bg-link max-md:bg-link max-md:text-white max-md:shadow-none max-md:before:hidden' : 'text-ink-soft hover:bg-white/65',
              )}
            >
              <Icon name={icon} />{label}<span className="ml-auto font-mono text-[12px] text-faint max-md:hidden">{count}</span>
            </a>
          ))}
        </nav>
        <div className="mt-auto max-md:hidden">
          <button onClick={logout}>Выйти</button>
          {owner && <a href="#" onClick={event => downloadExport(event).catch(error => toast(errorMessage(error)))} className={quietLink}>Скачать резервную копию JSON</a>}
          {owner && clients.length === 0 && <ImportButton />}
          <div className="border-t border-line px-12 py-16 leading-[1.7]">
            <small className="text-muted">Цикл поступления</small><br /><strong>{`Набор ${settings.year}`}</strong>
          </div>
          <div className="flex items-center gap-10 border-t border-line px-8 pt-20">
            <Avatar>{initials(user.name || user.email || 'U', /\s+/).toUpperCase()}</Avatar>
            <div>{user.name || user.email}<small className="mt-3 block text-muted">{owner ? 'Владелец' : 'Сотрудник'}</small></div>
          </div>
        </div>
      </aside>
      <main className="min-w-0">
        <header className="glass sticky top-12 z-2 flex min-h-58 items-center justify-between rounded-[18px] px-24 py-13 text-[12px] tracking-[.015em] text-muted max-md:top-0 max-md:min-h-52 max-md:rounded-none max-md:border-x-0 max-md:px-16 max-md:py-10 max-md:text-[11px]">
          <span>Рабочее пространство <span className="mx-10 text-[#b0b7c1]">/</span> <strong className="font-medium text-ink">{pageNames[active]}</strong></span>
          <span className="rounded-full border border-white bg-white/75 px-11 py-6 text-ink-soft shadow-[0_1px_2px_#0000000a]">{`Команда · ${settings.teamCount || 0}/10`}</span>
          <span className="max-md:hidden">{today.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long', year: 'numeric'})}</span>
        </header>
        <div className="mx-auto max-w-1400 px-28 py-34 max-md:px-16 max-md:py-24">{children}</div>
      </main>
    </div>
  );
}

function ImportButton() {
  const modal = useModal(), toast = useToast();
  function open() {
    try {
      const raw = localStorage.getItem(PROTOTYPE_KEY);
      if (!raw) {
        toast('Данных прототипа в этом браузере нет.');
        return;
      }
      const imported = JSON.parse(raw);
      if (!Array.isArray(imported)) throw Error('Некорректный импорт');
      modal.open('Импорт из прототипа', <ImportConfirm count={imported.length} />);
    } catch (error) {
      toast(errorMessage(error));
    }
  }
  return <button onClick={open}>Импорт из прототипа</button>;
}

function ImportConfirm({count}: {count: number}) {
  const {clients, save} = useCrm();
  const modal = useModal(), toast = useToast();
  async function confirm() {
    try {
      if (clients.length) throw Error('База уже содержит абитуриентов.');
      if (await save(JSON.parse(localStorage.getItem(PROTOTYPE_KEY) || '[]') as Client[])) {
        modal.close();
        toast('Карточки перенесены в базу');
      }
    } catch (error) {
      toast(errorMessage(error));
    }
  }
  return (
    <>
      <p>{`Будет перенесено ${count} карточек из этого браузера, включая демонстрационные. Импорт доступен только в пустую базу.`}</p>
      <div className="mt-23 flex justify-end gap-8">
        <button onClick={modal.close}>Отмена</button>
        <button className="primary" onClick={confirm}>Импортировать</button>
      </div>
    </>
  );
}
