import {useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode} from 'react';
import {useToast} from '../components/feedback';
import {Shell} from '../components/Shell';
import {Avatar, Badge, card, cx, Empty, errorText, Heading, Icon, Notice, PasswordField, Person, PersonSmall, subtle, TableWrap, type IconName} from '../components/ui';
import {rawValues} from '../forms/common';
import {check, downloadExport, errorMessage, invokeFunction, rpc, supabase} from '../lib/api';
import {newInvitationToken, sendInvitation, type InviteResult} from '../lib/invitations';
import {initials} from '../lib/crm';
import {useCrm} from '../state';
import type {Settings, Team} from '../types';

const field = 'my-16 block';
const formStatus = 'min-h-20 text-[12px] text-muted';
const formatInviteDate = (value: string | number) => new Date(value).toLocaleDateString('ru-RU', {day: 'numeric', month: 'short', year: 'numeric'});

/** Settings form: disables its button while `action` runs and reports progress or errors in a status line. */
function useSettingsForm(pending: string, action: (data: Record<string, string>, form: HTMLFormElement) => Promise<string | void>) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    pendingRef.current = true;
    const form = event.currentTarget;
    setBusy(true);
    setStatus(pending);
    try {
      setStatus(await action(rawValues(form), form) || '');
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      pendingRef.current = false;
      setBusy(false);
    }
  }
  return {status, busy, onSubmit};
}

function Section({title, text, icon = 'grid', className, children}: {title?: string; text?: string; icon?: IconName; className?: string; children: ReactNode}) {
  return (
    <section className={cx('p-24 max-sm:p-19', card, className)}>
      {title && (
        <div className="mb-22 flex items-start gap-13">
          <span className="grid size-38 shrink-0 place-items-center rounded-[12px] bg-[#e8f2ff] text-link"><Icon name={icon} /></span>
          <div><h2 className="mt-1 mb-4">{title}</h2>{text && <p className="m-0 text-[12px] leading-[1.5] text-muted">{text}</p>}</div>
        </div>
      )}
      {children}
    </section>
  );
}

export function SettingsPage() {
  const {user, settings} = useCrm();
  const owner = user.role === 'owner';
  return (
    <Shell active="settings">
      <Heading title="Настройки" text="Рабочее пространство, команда и безопасность входа." />
      <div className={cx('mb-18 grid max-w-1180 grid-cols-3 overflow-hidden', card, 'max-md:grid-cols-[1fr]')}>
        {[
          ['Роль', owner ? 'Владелец' : 'Сотрудник'],
          ['Команда', `${settings.teamCount || 0} из 10`],
          ['Текущий набор', String(settings.year)],
        ].map(([label, value], index) => (
          <div key={label} className={cx('px-22 py-17', index > 0 && 'border-l border-line max-md:border-l-0 max-md:border-t')}>
            <span className="block text-[11px] text-muted">{label}</span><strong className="mt-5 block text-[17px] tracking-[-.02em]">{value}</strong>
          </div>
        ))}
      </div>
      <div className="grid max-w-1180 grid-cols-2 gap-18 max-lg:grid-cols-[1fr]">
        {owner ? <WorkspaceForm /> : (
          <Section title="Рабочее пространство" text="Основные параметры вашей CRM." icon="grid">
            <p><strong>{settings.organization}</strong></p>
            <p>{`Цикл поступления: набор ${settings.year}`}</p>
            <p className={cx(subtle, 'leading-[1.6]')}>Основные настройки меняет владелец.</p>
          </Section>
        )}
        <AccountSection />
        {owner && <RecoverySection />}
        {owner && (
          <Section title="Данные и экспорт" text="Резервная копия рабочего пространства." icon="file">
            <p className="mt-0 leading-[1.6] text-ink-soft">Выгрузка содержит карточки абитуриентов, заявки, задачи и отчёты.</p>
            <ExportLink />
          </Section>
        )}
        {owner && <TeamSection />}
      </div>
    </Shell>
  );
}

function ExportLink() {
  const toast = useToast();
  return <a className="mt-8 inline-flex min-h-42 items-center gap-8 rounded-[11px] border border-[#0000001a] bg-white px-15 py-9 font-medium text-ink shadow-[0_1px_2px_#0000000a] hover:no-underline" href="#" onClick={event => downloadExport(event).catch(error => toast(errorMessage(error)))}><Icon name="file" /> Скачать JSON</a>;
}

function WorkspaceForm() {
  const {user, settings, setSettings, setUser} = useCrm();
  const toast = useToast();
  const {status, busy, onSubmit} = useSettingsForm('Сохранение…', async data => {
    const next = await rpc<Settings>('update_settings', {p_name: data.name, p_organization: data.organization, p_year: Number(data.year)});
    setSettings(next);
    if (next.currentUser) setUser(next.currentUser);
    toast('Настройки сохранены');
  });
  return (
    <Section title="Рабочее пространство" text="Название, владелец и цикл поступления." icon="grid">
      <form onSubmit={onSubmit}>
        <label className={field}>Имя владельца<input name="name" required maxLength={100} defaultValue={settings.name || user.name || ''} /></label>
        <label className={field}>Название организации<input name="organization" required maxLength={100} defaultValue={settings.organization} /></label>
        <label className={field}>Год набора по умолчанию<input type="number" name="year" min={2020} max={2100} required defaultValue={settings.year} /></label>
        <p className={subtle}>Новый год применяется к новым карточкам.</p>
        <p className={formStatus} role="status">{status}</p>
        <button className="primary" disabled={busy}>Сохранить настройки</button>
      </form>
    </Section>
  );
}

function AccountSection() {
  const {user, signOut} = useCrm();
  const toast = useToast();
  const {status, busy, onSubmit} = useSettingsForm('Сохранение…', async data => {
    if (data.newPassword !== data.confirmPassword) throw Error('Новые пароли не совпадают.');
    if (data.newPassword.length < 12) throw Error('Пароль должен содержать от 12 до 256 символов.');
    const {error} = await supabase.auth.signInWithPassword({email: user.email, password: data.currentPassword});
    if (error) throw Error(/invalid login/i.test(error.message) ? 'Неверный текущий пароль.' : errorMessage(error));
    check(await supabase.auth.updateUser({password: data.newPassword}));
    // End every session of this account, as the old server did after a password change.
    check(await supabase.auth.signOut({scope: 'global'}));
    signOut();
    toast('Пароль изменён. Войдите заново.');
  });
  return (
    <Section title="Ваш вход" text="Личная учётная запись и пароль." icon="people">
      <div className="mb-22 flex items-center gap-12 rounded-[14px] bg-[#f8f8fa] p-14">
        <Avatar className="size-42 text-[14px]">{initials(user.name || user.email || 'U', /\s+/)}</Avatar>
        <div><strong className="block">{user.name || 'Пользователь'}</strong><span className="mt-3 block text-[12px] text-muted">{user.email || ''}</span></div>
      </div>
      <form onSubmit={onSubmit}>
        <PasswordField className={field} name="currentPassword" label="Текущий пароль" />
        <PasswordField className={field} name="newPassword" label="Новый пароль — минимум 12 символов" />
        <PasswordField className={field} name="confirmPassword" label="Повторите новый пароль" />
        <p className={subtle}>После смены пароля текущие сессии будут завершены.</p>
        <p className={formStatus} role="status">{status}</p>
        <button disabled={busy}>Изменить пароль</button>
      </form>
    </Section>
  );
}

function RecoverySection() {
  const {settings, setSettings} = useCrm();
  const [code, setCode] = useState('');
  const {status, busy, onSubmit} = useSettingsForm('Сохранение…', async (data, form) => {
    const code = await rpc<string>('create_recovery_code', {p_current_password: data.currentPassword});
    setSettings(s => ({...s, recoveryEnabled: true}));
    form.reset();
    setCode(code);
    return 'Новый код создан.';
  });
  return (
    <Section title="Восстановление доступа" text="Резервный код владельца CRM." icon="check">
      <div className="mb-18 flex items-center justify-between gap-12 rounded-[14px] bg-[#f8f8fa] px-14 py-12">
        <span className="text-[12px] text-ink-soft">{settings.recoveryEnabled ? 'Резервный код настроен' : 'Резервный код не создан'}</span>
        <Badge tone={settings.recoveryEnabled ? 'green' : 'amber'}>{settings.recoveryEnabled ? 'Защищено' : 'Требует настройки'}</Badge>
      </div>
      <form onSubmit={onSubmit}>
        <PasswordField className={field} name="currentPassword" label="Текущий пароль" />
        <p className={subtle}>Новый код отменяет предыдущий и показывается один раз.</p>
        <p className={formStatus} role="status">{status}</p>
        <button disabled={busy}>Создать резервный код</button>
      </form>
      <div id="recovery-result">
        {code && (
          <Notice>
            <strong>Сохраните этот код сейчас</strong>
            <p><code className="text-[16px] wrap-anywhere select-all">{code}</code></p>
            <p>После ухода со страницы код больше не будет показан.</p>
          </Notice>
        )}
      </div>
    </Section>
  );
}

function TeamSection() {
  const {setSettings} = useCrm();
  const toast = useToast();
  const [team, setTeam] = useState<Team | null>(null);
  const [loadError, setLoadError] = useState('');
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const attempt = useRef<{key: string; token: string} | null>(null);
  const [resending, setResending] = useState(false);
  const deliveryPending = useRef(false);

  const applyTeam = useCallback((next: Team) => {
    setTeam(next);
    setSettings(s => ({...s, teamCount: next.used}));
  }, [setSettings]);

  const loadTeam = useCallback(async () => {
    try {
      applyTeam(await rpc<Team>('team_overview'));
      setLoadError('');
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [applyTeam]);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  const {status, busy, onSubmit} = useSettingsForm('Отправка…', async (data, form) => {
    const result = await deliver(data.email, data.name);
    form.reset();
    setInvite(result);
    await loadTeam();
    return result.sent ? 'Письмо принято почтовым сервисом.' : 'Автоматическая отправка не подтверждена. Проверьте сообщение ниже; ссылку можно отправить вручную.';
  });

  async function deliver(email: string, name: string) {
    if (deliveryPending.current) throw Error('Дождитесь завершения отправки.');
    deliveryPending.current = true;
    try {
      const key = `${email.trim().toLowerCase()}\n${name.trim()}`;
      if (attempt.current?.key !== key) attempt.current = {key, token: newInvitationToken()};
      setInvite(null);
      const result = await sendInvitation({email, name, token: attempt.current!.token}, {
        invoke: input => invokeFunction<InviteResult>('send-team-invite', input),
        create: input => rpc<{email: string; token: string}>('create_invitation', {p_email: input.email, p_name: input.name, p_token: input.token}),
        siteUrl: location.origin + location.pathname,
      });
      setInvite(result);
      attempt.current = null;
      return result;
    } finally {
      deliveryPending.current = false;
      await loadTeam();
    }
  }

  async function resend(email: string, name: string) {
    setResending(true);
    try {
      const result = await deliver(email, name);
      toast(result.sent ? 'Повторное письмо принято почтовым сервисом' : 'Автоотправка не подтверждена. Проверьте сообщение ниже.');
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      setResending(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast('Ссылка скопирована');
    } catch {
      toast('Не удалось скопировать. Выделите ссылку вручную.');
    }
  }

  return (
    <Section className="col-span-full" title="Команда" text="Приглашайте сотрудников и управляйте их доступом." icon="people">
      <p className="mt-0 mb-16 text-[12px] text-muted">Повторная отправка создаёт новую ссылку и отменяет предыдущую.</p>
      <form className="mb-24 grid grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)_auto] items-end gap-12 rounded-[16px] bg-[#f8f8fa] p-18 max-md:grid-cols-[1fr]" onSubmit={onSubmit}>
        <label className="m-0">Имя сотрудника<input name="name" required maxLength={100} placeholder="Имя и фамилия" /></label>
        <label className="m-0">Рабочая почта<input name="email" type="email" required maxLength={254} placeholder="name@company.kz" /></label>
        <button className="primary h-42" disabled={busy || resending}>Отправить приглашение</button>
        <p className={cx(formStatus, 'col-span-full m-0 max-md:col-auto')} role="status">{status}</p>
      </form>
      <div id="invite-result">
        {invite && (invite.sent ? (
          <Notice><strong>Письмо принято почтовым сервисом</strong><p>{`Приглашение для ${invite.email}. Ссылка действует 7 дней; доставка письма подтверждается в Resend.`}</p>{invite.warning && <p className={errorText}>{invite.warning}</p>}</Notice>
        ) : (
          <Notice>
            <strong>Скопируйте ссылку сотруднику</strong>
            <p className="font-mono wrap-anywhere select-all">{invite.inviteUrl}</p>
            <button type="button" onClick={() => copy(invite.inviteUrl)}>Скопировать ссылку</button>
            {invite.warning && <p className={errorText}>{invite.warning}</p>}
          </Notice>
        ))}
      </div>
      <div id="team-list">
        {loadError && <p className={errorText}>{loadError}</p>}
        {team ? <TeamTable team={team} onChange={applyTeam} resend={resend} deliveryBusy={busy || resending} /> : <p className={subtle}>Загрузка команды…</p>}
      </div>
    </Section>
  );
}

function TeamTable({team, onChange, resend, deliveryBusy}: {team: Team; onChange(team: Team): void; resend(email: string, name: string): Promise<void>; deliveryBusy: boolean}) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const pendingRef = useRef(false);
  async function act(id: string, name: string, args: Record<string, unknown>, message: string) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setBusy(id);
    try {
      onChange(await rpc<Team>(name, args));
      toast(message);
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      pendingRef.current = false;
      setBusy('');
    }
  }
  const small = 'mt-3 text-[11px] tracking-[.01em]';
  return (
    <>
      <div className="mb-14 flex items-baseline gap-10">
        <strong className="text-[22px] tracking-[-.03em]">{`${team.used} из ${team.limit}`}</strong>
        <span className="text-[12px] text-muted">мест занято активными сотрудниками и приглашениями</span>
      </div>
      <div className="mb-18 h-6 overflow-hidden rounded-full bg-tint" aria-label={`${team.used} из ${team.limit} мест занято`}><span className="block h-full rounded-full bg-link" style={{width: `${Math.min(100, team.used / team.limit * 100)}%`}} /></div>
      <TableWrap className="max-md:-mx-16 max-md:rounded-none max-md:border-x-0">
        <thead><tr><th>Сотрудник</th><th>Статус</th><th>Добавлен</th><th className="text-right"></th></tr></thead>
        <tbody>
          {team.members.map(member => {
            const active = member.status === 'active';
            const owner = member.role === 'owner';
            return (
              <tr key={member.id}>
                <td><Person avatar={<Avatar>{initials(member.name, /\s+/)}</Avatar>}><strong>{member.name}</strong><PersonSmall className={small}>{`${owner ? 'Владелец' : 'Сотрудник'} · ${member.email}`}</PersonSmall></Person></td>
                <td><Badge tone={active ? 'green' : 'neutral'}>{active ? 'Активен' : 'Отключён'}</Badge></td>
                <td>{formatInviteDate(member.createdAt)}</td>
                <td className="text-right whitespace-nowrap">
                  <button disabled={busy === member.id} onClick={() => act(member.id, 'set_member_role', {p_id: member.id, p_role: owner ? 'staff' : 'owner'}, owner ? 'Права владельца сняты' : 'Сотрудник назначен владельцем')}>{owner ? 'Сделать сотрудником' : 'Сделать владельцем'}</button>{' '}
                  <button disabled={busy === member.id} onClick={() => act(member.id, 'set_staff_status', {p_id: member.id, p_status: active ? 'disabled' : 'active'}, active ? 'Доступ сотрудника отключён' : 'Доступ сотрудника включён')}>{active ? 'Отключить' : 'Включить'}</button>
                </td>
              </tr>
            );
          })}
          {team.invitations.map(invite => (
            <tr key={invite.id}>
              <td><Person avatar={<Avatar>…</Avatar>}><strong>{invite.name}</strong><PersonSmall className={small}>{invite.email}</PersonSmall></Person></td>
              <td><Badge tone={invite.sentAt ? 'blue' : 'amber'}>{invite.sentAt ? 'Принято почтовым сервисом' : 'Ссылка создана'}</Badge></td>
              <td>{`до ${formatInviteDate(invite.expires)}`}</td>
              <td className="text-right"><button disabled={!!busy || deliveryBusy} onClick={() => resend(invite.email, invite.name)}>Отправить повторно</button>{' '}<button disabled={!!busy || deliveryBusy} onClick={() => act(invite.id, 'revoke_invitation', {p_id: invite.id}, 'Приглашение отозвано')}>Отозвать</button></td>
            </tr>
          ))}
          {!team.members.length && !team.invitations.length && <tr><td colSpan={4}><Empty>Пока нет сотрудников. Отправьте первое приглашение.</Empty></td></tr>}
        </tbody>
      </TableWrap>
    </>
  );
}
