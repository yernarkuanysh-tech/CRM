import {useEffect, useState, type FormEvent, type ReactNode} from 'react';
import {useToast} from '../components/feedback';
import {BrandLogo, PasswordField, subtle} from '../components/ui';
import {api, errorMessage, setCsrf} from '../lib/api';
import type {User} from '../types';

const formValues = (form: HTMLFormElement) => Object.fromEntries(new FormData(form)) as Record<string, string>;

function AuthCard({className = '', children}: {className?: string; children: ReactNode}) {
  return (
    <main className={`mx-auto my-[8vh] w-[min(440px,calc(100vw-32px))] rounded-[12px] border border-line bg-canvas p-32 shadow-login max-md:my-24 max-md:p-25 ${className}`}>
      <div className="mb-34"><BrandLogo organization="GrantEd" large /></div>
      {children}
    </main>
  );
}

const title = 'm-0 mb-9 text-[32px] leading-[40px] font-semibold tracking-[-.04em]';
const lead = 'leading-[1.55] text-muted';
const alertText = 'not-empty:my-10 not-empty:text-[12px]';

/** Runs `action` on submit with the submit button disabled; returns the error message setter. */
function useSubmit(action: (form: HTMLFormElement) => Promise<void>) {
  const [error, setError] = useState('');
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('button')!;
    button.disabled = true;
    try {
      await action(form);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      button.disabled = false;
    }
  }
  return {error, onSubmit};
}

export function LoginPage({initialized, onSignedIn, onRecover}: {initialized: boolean; onSignedIn(): void; onRecover(): void}) {
  const {error, onSubmit} = useSubmit(async form => {
    await api('/api/auth/' + (initialized ? 'login' : 'setup'), {method: 'POST', body: JSON.stringify(formValues(form))});
    onSignedIn();
  });
  return (
    <AuthCard>
      <h1 className={title}>{initialized ? 'Вход в CRM' : 'Создание владельца'}</h1>
      <p className={lead}>{initialized ? 'Войдите со своей рабочей почтой.' : 'Создайте учётную запись владельца рабочего пространства.'}</p>
      <form id="login-form" className="mt-27" onSubmit={onSubmit}>
        <label className="my-18 block">Почта<input className="mt-8 block w-full" name="email" type="email" required autoComplete="username" /></label>
        <label className="my-18 block">Пароль<input className="mt-8 block w-full" name="password" type="password" required minLength={initialized ? 1 : 12} maxLength={256} autoComplete={initialized ? 'current-password' : 'new-password'} /></label>
        <p id="login-error" className={`text-[#a12828] ${alertText}`} role="alert">{error}</p>
        <button className="primary mt-3 w-full">{initialized ? 'Войти' : 'Создать и войти'}</button>
      </form>
      {initialized && <p className={lead}><button type="button" onClick={onRecover}>Забыли пароль владельца?</button></p>}
      <p className={`${subtle} ${lead}`}>Каждый сотрудник входит под своей учётной записью.</p>
    </AuthCard>
  );
}

interface InviteInfo {
  email: string;
  name: string;
  organization: string;
}

export function InvitePage({token, onSignedIn, onBack}: {token: string; onSignedIn(user: User): void; onBack(): void}) {
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    api<InviteInfo>('/api/auth/invite?token=' + encodeURIComponent(token)).then(setInvite, error => setLoadError(errorMessage(error)));
  }, [token]);
  const {error, onSubmit} = useSubmit(async form => {
    const data = formValues(form);
    if (data.password !== data.confirmPassword) throw Error('Пароли не совпадают.');
    const result = await api<{csrf: string; user: User}>('/api/auth/accept-invite', {method: 'POST', body: JSON.stringify({token, name: data.name, password: data.password})});
    setCsrf(result.csrf);
    onSignedIn(result.user);
  });

  if (loadError) {
    return (
      <AuthCard>
        <h1 className={title}>Приглашение недоступно</h1>
        <p className={lead}>{loadError}</p>
        <button className="primary" onClick={onBack}>Вернуться ко входу</button>
      </AuthCard>
    );
  }
  if (!invite) return null;
  return (
    <AuthCard>
      <p className={`mx-0 mt-0 mb-12 font-mono text-[10px] font-[650] tracking-[.04em] uppercase ${lead}`}>Приглашение в команду</p>
      <h1 className={title}>{`Присоединиться к ${invite.organization}`}</h1>
      <p className={lead}>Приглашение отправлено на <strong className="font-semibold">{invite.email}</strong>. Создайте личный пароль для входа.</p>
      <form id="invite-form" onSubmit={onSubmit}>
        <label>Ваше имя<input name="name" required maxLength={100} defaultValue={invite.name} autoComplete="name" /></label>
        <label>Новый пароль<input name="password" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /></label>
        <label>Повторите пароль<input name="confirmPassword" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /></label>
        <p id="invite-error" className={`text-danger ${alertText}`} role="alert">{error}</p>
        <button className="primary">Принять приглашение</button>
      </form>
      <p className={`${subtle} ${lead}`}>Ссылка действует один раз. Не пересылайте её другим людям.</p>
    </AuthCard>
  );
}

export function RecoveryPage({onDone, onBack}: {onDone(): void; onBack(): void}) {
  const toast = useToast();
  const {error, onSubmit} = useSubmit(async form => {
    const data = formValues(form);
    if (data.newPassword !== data.confirmPassword) throw Error('Новые пароли не совпадают.');
    await api('/api/auth/recover', {method: 'POST', body: JSON.stringify(data)});
    onDone();
    toast('Пароль восстановлен.');
  });
  return (
    <main className="mx-auto my-[6vh] max-w-480 p-28">
      <h1>Восстановить пароль владельца</h1>
      <p>Введите почту владельца и резервный код.</p>
      <form id="recover-form" onSubmit={onSubmit}>
        <label className="my-16 block">Почта<input name="email" type="email" required autoComplete="username" /></label>
        <label className="my-16 block">Резервный код<input name="code" required maxLength={200} autoComplete="off" spellCheck={false} /></label>
        <PasswordField className="my-16 block" name="newPassword" label="Новый пароль — минимум 12 символов" />
        <PasswordField className="my-16 block" name="confirmPassword" label="Повторите новый пароль" />
        <p className="min-h-20 text-[#9c2020]" role="alert">{error}</p>
        <button className="primary">Восстановить доступ</button>
      </form>
      <p><button onClick={onBack}>Вернуться ко входу</button></p>
    </main>
  );
}
