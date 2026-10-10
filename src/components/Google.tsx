import {useState, type FormEvent, type ReactNode} from 'react';
import {api, errorMessage} from '../lib/api';
import {useCrm} from '../state';
import {useModal, useToast} from './feedback';

interface Connection {
  kind: string;
  email: string;
  owner: string;
}

interface Message {
  snippet: string;
  headers: {name: string; value: string}[];
}

export type GoogleResult =
  | {kind: 'status'; configured: boolean; connections: Connection[]}
  | {kind: 'messages'; messages: Message[]}
  | {kind: 'files'; files?: {id: string; name: string}[]; nextPageToken?: string};

type LoadAction = GoogleResult['kind'];

/** Button that loads Google data (connections, mail or Drive files) into a result area. */
export function GoogleLoadButton({action, client, onResult, className, children}: {action: LoadAction; client?: string; onResult(result: GoogleResult): void; className?: string; children: ReactNode}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    try {
      const result = await api<object>('/api/google/' + action + (client ? '?client=' + encodeURIComponent(client) : ''));
      onResult({kind: action, ...result} as GoogleResult);
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return <button className={className} disabled={busy} onClick={load}>{children}</button>;
}

/** Starts the Google OAuth flow for Drive (workspace) or Gmail (one client card). */
export function GoogleConnectButton({kind, client, children}: {kind: 'drive' | 'gmail'; client?: string; children: ReactNode}) {
  const {clientById} = useCrm();
  const modal = useModal(), toast = useToast();
  const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true);
    try {
      const status = await api<{configured: boolean}>('/api/google/status');
      if (!status.configured) throw Error('Google ещё не настроен на сервере. Инструкция находится в README проекта.');
      modal.open('Подключить Google', <GoogleConnectForm kind={kind} client={client} email={clientById(client)?.email || ''} />);
    } catch (error) {
      toast(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return <button disabled={busy} onClick={connect}>{children}</button>;
}

function GoogleConnectForm({kind, client, email}: {kind: string; client?: string; email: string}) {
  const [error, setError] = useState('');
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await api<{url: string}>('/api/google/authorize', {method: 'POST', body: JSON.stringify({kind, client, email: new FormData(event.currentTarget).get('email')})});
      location.href = result.url;
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <form id="google-form" onSubmit={onSubmit}>
      <p>Выберите аккаунт владельца документов или почты. Пароль вводится только на странице Google.</p>
      <label>Почта Google<input type="email" name="email" required defaultValue={email} /></label>
      <p id="google-error" role="alert">{error}</p>
      <button className="primary">Перейти в Google</button>
    </form>
  );
}

function DisconnectButton({owner}: {owner: string}) {
  const toast = useToast();
  const [state, setState] = useState<'idle' | 'busy' | 'removed'>('idle');
  async function disconnect() {
    setState('busy');
    try {
      await api('/api/google/disconnect', {method: 'POST', body: JSON.stringify({owner})});
      toast('Подключение удалено из CRM.');
      setState('removed');
    } catch (error) {
      toast(errorMessage(error));
      setState('idle');
    }
  }
  if (state === 'removed') return null;
  return <button disabled={state === 'busy'} onClick={disconnect}>Отключить</button>;
}

const header = (message: Message, name: string) => message.headers.find(h => h.name.toLowerCase() === name)?.value;

export function GoogleResultView({result}: {result: GoogleResult | null}) {
  const {user} = useCrm();
  if (!result) return <div id="google-result" />;
  let body: ReactNode;
  if (result.kind === 'status') {
    body = <>
      <p>{result.configured ? 'Google настроен на сервере.' : 'Google пока не настроен на сервере.'}</p>
      {result.connections.map(connection => (
        <p key={connection.owner}>{`${connection.kind} · ${connection.email} `}{user.role === 'owner' && <DisconnectButton owner={connection.owner} />}</p>
      ))}
    </>;
  } else if (result.kind === 'messages') {
    body = result.messages.length ? result.messages.map((message, i) => (
      <article key={i} className="mt-13 rounded-[8px] border border-line p-19">
        <strong>{header(message, 'subject') || 'Без темы'}</strong>
        <p className="text-[13px] leading-[1.65] text-muted">{header(message, 'from') || ''}</p>
        <p className="text-[13px] leading-[1.65] text-muted">{message.snippet}</p>
      </article>
    )) : <p>Писем нет.</p>;
  } else {
    const files = result.files || [];
    body = files.length || result.nextPageToken ? <>
      {files.map(file => <p key={file.id}><a href={`https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`} target="_blank" rel="noopener noreferrer">{file.name}</a></p>)}
      {result.nextPageToken && <p>Показаны первые 100 файлов. Все файлы доступны в папке Drive.</p>}
    </> : <p>Папка пуста.</p>;
  }
  return <div id="google-result">{body}</div>;
}
