import type {ReactNode} from 'react';
import {check, downloadExport, errorMessage, supabase} from '../lib/api';
import {allTasks, initials, PROTOTYPE_KEY} from '../lib/crm';
import {isDueSoon, today} from '../lib/dates';
import {useCrm} from '../state';
import type {Client} from '../types';
import {useModal, useToast} from './feedback';
import {Avatar, BrandLogo, cx, Icon, quietLink, type IconName} from './ui';

export type Section = 'clients' | 'tasks' | 'integrations' | 'settings';

const pageNames: Record<Section, string> = {clients: 'Клиенты', tasks: 'Задачи', settings: 'Настройки', integrations: 'Интеграции'};

export function Shell({active = 'clients', children}: {active?: Section; children: ReactNode}) {
  const {user, settings, clients, signOut} = useCrm();
  const toast = useToast();
  const owner = user.role === 'owner';
  const navigation: [Section, IconName, string, number | ''][] = [
    ['clients', 'people', 'Клиенты', clients.length],
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
    <div className="grid min-h-screen grid-cols-[232px_minmax(0,1fr)] max-xl:grid-cols-[208px_1fr] max-md:block">
      <aside className="sticky top-0 flex h-screen flex-col border-r border-line bg-white px-16 pt-24 pb-16 max-md:static max-md:h-auto max-md:border-r-0 max-md:border-b max-md:py-12">
        <a href="#clients" className="flex items-center gap-10 px-8 pb-28 text-[17px] font-[650] tracking-[-.02em] text-ink max-xl:text-[15px]" aria-label={`${settings.organization || 'GrantEd'} — главная`}>
          <BrandLogo organization={settings.organization} />
        </a>
        <p className="mx-12 mt-0 mb-13 font-mono text-[10px] font-[650] tracking-[.04em] text-faint uppercase max-md:hidden">Рабочее пространство</p>
        <nav className="flex flex-col gap-2 max-md:flex-row max-md:overflow-auto" aria-label="Основное меню">
          {navigation.map(([id, icon, label, count]) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={active === id ? 'page' : undefined}
              className={cx(
                'relative flex items-center gap-11 rounded-[6px] px-12 py-9 text-[14px] font-medium hover:no-underline max-md:whitespace-nowrap',
                active === id ? 'bg-tint text-ink shadow-[inset_2px_0_#171717] max-md:bg-ink max-md:text-white max-md:shadow-none' : 'text-ink-soft hover:bg-canvas',
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
        <header className="flex min-h-64 items-center justify-between border-b border-line bg-white px-32 py-16 text-[12px] tracking-[.015em] text-muted max-md:min-h-56 max-md:px-16 max-md:py-12 max-md:text-[11px]">
          <span>Рабочее пространство <span className="mx-10 text-[#b0b7c1]">/</span> <strong className="font-medium text-ink">{pageNames[active]}</strong></span>
          <span className="rounded-full border border-line bg-tint px-10 py-5 text-ink-soft">{`Команда · ${settings.teamCount || 0}/10`}</span>
          <span className="max-md:hidden">{today.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long', year: 'numeric'})}</span>
        </header>
        <div className="mx-auto max-w-1400 p-32 max-md:px-16 max-md:py-24">{children}</div>
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
      if (clients.length) throw Error('База уже содержит клиентов.');
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
