import {useModal} from '../components/feedback';
import {Shell} from '../components/Shell';
import {cx, Empty, Heading, Icon, SectionTop, subtle} from '../components/ui';
import {TaskForm} from '../forms/TaskForm';
import {allTasks} from '../lib/crm';
import {fmt, isOverdue, isToday} from '../lib/dates';
import {useCrm} from '../state';
import type {Client, Task} from '../types';

export function TaskRow({task: t, client: c, showClient = false}: {task: Task; client: Client; showClient?: boolean}) {
  const {updateClient} = useCrm();
  const toggle = (done: boolean) => updateClient(c.id, draft => { draft.tasks.find(x => x.id === t.id)!.done = done; });
  return (
    <div className="flex items-start gap-12 border-b border-line py-17">
      <input key={String(t.done)} className="mt-2 size-17 accent-ink" type="checkbox" id={`task-${t.id}`} defaultChecked={t.done} onChange={e => toggle(e.target.checked)} />
      <label className="flex-1 cursor-pointer" htmlFor={`task-${t.id}`}>
        <strong className={cx('text-[13px] font-medium', t.done && 'text-muted line-through')}>{t.title}</strong>
        <span className="my-5 block text-[12px] text-muted">{`${showClient ? c.name + ' · ' : ''}${t.done ? 'Выполнено' : isOverdue(t.date) ? 'Просрочено' : isToday(t.date) ? 'Сегодня' : 'Срок'} · ${fmt(t.date)}`}</span>
      </label>
      {showClient && <a className="text-[12px]" href={`#client/${c.id}/tasks`}>Карточка</a>}
    </div>
  );
}

export function TasksPage() {
  const {clients} = useCrm();
  const modal = useModal();
  const tasks = allTasks(clients);
  const pending = tasks.filter(t => !t.done).sort((a, b) => a.date.localeCompare(b.date));
  const done = tasks.filter(t => t.done);
  return (
    <Shell active="tasks">
      <Heading title="Задачи" text={`${pending.length} открытых · ${pending.filter(t => isOverdue(t.date)).length} просроченных`}>
        <button className="primary" onClick={() => modal.open('Новая задача', <TaskForm />)}><Icon name="plus" /> Добавить задачу</button>
      </Heading>
      <div className="max-w-900">
        <SectionTop><h2>Предстоящие</h2><span className={subtle}>По сроку выполнения</span></SectionTop>
        {pending.map(t => <TaskRow key={t.client.id + t.id} task={t} client={t.client} showClient />)}
        {!pending.length && <Empty>Все задачи выполнены.</Empty>}
        {done.length > 0 && (
          <details className="mt-26">
            <summary>{`Выполненные · ${done.length}`}</summary>
            {done.map(t => <TaskRow key={t.client.id + t.id} task={t} client={t.client} showClient />)}
          </details>
        )}
      </div>
    </Shell>
  );
}
