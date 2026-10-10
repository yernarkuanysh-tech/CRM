import {useCallback, useEffect, useState, type FormEvent, type ReactNode} from 'react';
import {useToast} from '../components/feedback';
import {Shell} from '../components/Shell';
import {Avatar, Badge, card, cx, Empty, errorText, Heading, Notice, PasswordField, Person, PersonSmall, quietLink, SectionTop, subtle, TableWrap} from '../components/ui';
import {rawValues} from '../forms/common';
import {check, downloadExport, errorMessage, rpc, supabase} from '../lib/api';
import {initials} from '../lib/crm';
import {useCrm} from '../state';
import type {Settings, Team} from '../types';

const field = 'my-16 block';
const formStatus = 'min-h-20 text-[#9c2020]';
const formatInviteDate = (value: string | number) => new Date(value).toLocaleDateString('ru-RU', {day: 'numeric', month: 'short', year: 'numeric'});

/** Settings form: disables its button while `action` runs and reports progress or errors in a status line. */
function useSettingsForm(pending: string, action: (data: Record<string, string>, form: HTMLFormElement) => Promise<string | void>) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setStatus(pending);
    try {
      setStatus(await action(rawValues(form), form) || '');
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return {status, busy, onSubmit};
}

function Section({title, className, children}: {title?: string; className?: string; children: ReactNode}) {
  return (
    <section className={cx('p-24', card, className)}>
      {title && <h2 className="mb-16">{title}</h2>}
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
      <div className="grid max-w-1050 grid-cols-2 gap-24 max-lg:grid-cols-[1fr]">
        {owner ? <WorkspaceForm /> : (
          <Section title="Рабочее пространство">
            <p><strong>{settings.organization}</strong></p>
            <p>{`Цикл поступления: набор ${settings.year}`}</p>
            <p className={cx(subtle, 'leading-[1.6]')}>Основные настройки меняет владелец.</p>
          </Section>
        )}
        <AccountSection />
        {owner && <RecoverySection />}
        {owner && (
          <Section title="Данные и подключения">
            <p>Выгрузка содержит карточки, заявки, задачи и отчёты.</p>
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
  return <a className={quietLink} href="#" onClick={event => downloadExport(event).catch(error => toast(errorMessage(error)))}>Скачать JSON</a>;
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
    <Section title="Рабочее пространство">
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
    <Section title="Ваш вход">
      <p>{user.name || ''}</p>
      <p>Почта: <strong>{user.email || ''}</strong></p>
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
    <Section title="Восстановление владельца">
      <p>{`${settings.recoveryEnabled ? 'Резервный код создан.' : 'Резервный код пока не создан.'} Храните его отдельно от CRM.`}</p>
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

interface InviteResult {
  email: string;
  inviteUrl: string;
  sent: boolean;
  warning?: string;
}

function TeamSection() {
  const {setSettings} = useCrm();
  const toast = useToast();
  const [team, setTeam] = useState<Team | null>(null);
  const [loadError, setLoadError] = useState('');
  const [invite, setInvite] = useState<InviteResult | null>(null);

  const applyTeam = useCallback((next: Team) => {
    setTeam(next);
    setSettings(s => ({...s, teamCount: next.used}));
  }, [setSettings]);

  const loadTeam = useCallback(async () => {
    try {
      applyTeam(await rpc<Team>('team_overview'));
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [applyTeam]);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  const {status, busy, onSubmit} = useSettingsForm('Отправка…', async (data, form) => {
    const created = await rpc<{email: string; token: string}>('create_invitation', {p_email: data.email, p_name: data.name});
    // Email delivery is not wired up yet: the owner sends the link manually.
    const result: InviteResult = {email: created.email, inviteUrl: `${location.origin}${location.pathname}#invite/${created.token}`, sent: false};
    form.reset();
    setInvite(result);
    await loadTeam();
    return result.sent ? 'Приглашение отправлено на email.' : 'Приглашение создано, но автоматическая отправка ещё не настроена.';
  });

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast('Ссылка скопирована');
    } catch {
      toast('Не удалось скопировать. Выделите ссылку вручную.');
    }
  }

  return (
    <Section className="col-span-full">
      <SectionTop><div><h2 className="mb-16">Команда</h2><p className={subtle}>До 10 сотрудников с личным входом.</p></div></SectionTop>
      <form className="mt-20 mb-24 grid grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)_auto] items-end gap-12 max-md:grid-cols-[1fr]" onSubmit={onSubmit}>
        <label className="m-0">Имя сотрудника<input name="name" required maxLength={100} placeholder="Имя и фамилия" /></label>
        <label className="m-0">Рабочая почта<input name="email" type="email" required maxLength={254} placeholder="name@company.kz" /></label>
        <button className="primary h-40" disabled={busy}>Отправить приглашение</button>
        <p className={cx(formStatus, 'col-span-full m-0 max-md:col-auto')} role="status">{status}</p>
      </form>
      <div id="invite-result">
        {invite && (invite.sent ? (
          <Notice><strong>Письмо отправлено</strong><p>{`${invite.email} получит одноразовую ссылку, действующую 7 дней.`}</p></Notice>
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
        {loadError ? <p className={errorText}>{loadError}</p> : team ? <TeamTable team={team} onChange={applyTeam} /> : <p className={subtle}>Загрузка команды…</p>}
      </div>
    </Section>
  );
}

function TeamTable({team, onChange}: {team: Team; onChange(team: Team): void}) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  async function act(id: string, name: string, args: Record<string, unknown>, message: string) {
    setBusy(id);
    try {
      onChange(await rpc<Team>(name, args));
      toast(message);
    } catch (error) {
      toast(errorMessage(error));
    } finally {
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
      <TableWrap className="max-md:-mx-16 max-md:rounded-none max-md:border-x-0">
        <thead><tr><th>Сотрудник</th><th>Статус</th><th>Добавлен</th><th className="text-right"></th></tr></thead>
        <tbody>
          {team.staff.map(member => {
            const active = member.status === 'active';
            return (
              <tr key={member.id}>
                <td><Person avatar={<Avatar>{initials(member.name, /\s+/)}</Avatar>}><strong>{member.name}</strong><PersonSmall className={small}>{member.email}</PersonSmall></Person></td>
                <td><Badge tone={active ? 'green' : 'neutral'}>{active ? 'Активен' : 'Отключён'}</Badge></td>
                <td>{formatInviteDate(member.createdAt)}</td>
                <td className="text-right">
                  <button disabled={busy === member.id} onClick={() => act(member.id, 'set_staff_status', {p_id: member.id, p_status: active ? 'disabled' : 'active'}, active ? 'Доступ сотрудника отключён' : 'Доступ сотрудника включён')}>{active ? 'Отключить' : 'Включить'}</button>
                </td>
              </tr>
            );
          })}
          {team.invitations.map(invite => (
            <tr key={invite.id}>
              <td><Person avatar={<Avatar>…</Avatar>}><strong>{invite.name}</strong><PersonSmall className={small}>{invite.email}</PersonSmall></Person></td>
              <td><Badge tone="amber">Ожидает</Badge></td>
              <td>{`до ${formatInviteDate(invite.expires)}`}</td>
              <td className="text-right"><button disabled={busy === invite.id} onClick={() => act(invite.id, 'revoke_invitation', {p_id: invite.id}, 'Приглашение отозвано')}>Отозвать</button></td>
            </tr>
          ))}
          {!team.staff.length && !team.invitations.length && <tr><td colSpan={4}><Empty>Пока нет сотрудников. Отправьте первое приглашение.</Empty></td></tr>}
        </tbody>
      </TableWrap>
    </>
  );
}
