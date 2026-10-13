import {useCallback, useEffect, useRef, useState} from 'react';
import {ModalProvider} from './components/feedback';
import {check, errorMessage, loadClients, rpc, supabase} from './lib/api';
import {navigate, parseRoute, useHash} from './route';
import {CrmProvider, type Session} from './state';
import {ClientPage} from './pages/ClientPage';
import {ClientsPage} from './pages/ClientsPage';
import {IntegrationsPage} from './pages/IntegrationsPage';
import {InvitePage, LoginPage, RecoveryPage} from './pages/AuthPages';
import {SettingsPage} from './pages/SettingsPage';
import {TasksPage} from './pages/TasksPage';
import type {Client, Settings} from './types';

type Phase =
  | {kind: 'loading'}
  | {kind: 'error'; message: string}
  | {kind: 'login'; initialized: boolean}
  | {kind: 'invite'; token: string}
  | {kind: 'recover'}
  | {kind: 'ready'; session: Session};

const loginPhase = (initialized: boolean): Phase => {
  const invite = (location.hash || '').match(/^#invite\/(.+)$/);
  return invite ? {kind: 'invite', token: invite[1]} : {kind: 'login', initialized};
};

export function App() {
  const [phase, setPhase] = useState<Phase>({kind: 'loading'});
  const generation = useRef(0);
  const startupSignOut = useRef(false);
  const hash = useHash();
  const inviteToken = hash.match(/^#invite\/(.+)$/)?.[1] || '';

  const start = useCallback(async () => {
    const request = ++generation.current;
    const invite = location.hash.match(/^#invite\/(.+)$/)?.[1];
    if (invite) {
      setPhase({kind: 'invite', token: invite});
      return;
    }
    setPhase({kind: 'loading'});
    try {
      const {data: {session}} = check(await supabase.auth.getSession());
      const settings = session && await rpc<Settings | null>('crm_settings');
      if (!settings) {
        // No session, or the account has no active CRM access (e.g. disabled by the owner).
        if (session) {
          startupSignOut.current = true;
          try { await supabase.auth.signOut({scope: 'local'}); }
          finally { startupSignOut.current = false; }
        }
        const initialized = await rpc<boolean>('crm_initialized');
        if (request === generation.current) setPhase(loginPhase(initialized));
        return;
      }
      const rows = await loadClients();
      if (request !== generation.current) return;
      setPhase({kind: 'ready', session: {
        user: settings.currentUser!, settings,
        clients: rows.map(row => row.data as Client),
        revisions: Object.fromEntries(rows.map(row => [row.id, row.revision])),
      }});
    } catch (error) {
      if (request === generation.current) setPhase({kind: 'error', message: errorMessage(error)});
    }
  }, []);

  useEffect(() => { start(); }, [start, inviteToken]);

  // Signing out in another tab, or an expired refresh token, returns this tab to the login page.
  useEffect(() => {
    const {data} = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') {
        if (startupSignOut.current) return;
        generation.current++;
        setPhase(phase => ['ready', 'loading'].includes(phase.kind) ? loginPhase(true) : phase);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const backToLogin = useCallback(() => {
    generation.current++;
    navigate('');
    setPhase(loginPhase(true));
  }, []);

  switch (phase.kind) {
    case 'loading':
      return <p className="p-24 text-muted" role="status">Загружаем рабочее пространство…</p>;
    case 'error':
      return <div className="p-24"><p role="alert">Не удалось подключиться к серверу: {phase.message}</p><button onClick={start}>Повторить подключение</button></div>;
    case 'login':
      return <LoginPage initialized={phase.initialized} onSignedIn={start} onRecover={() => setPhase({kind: 'recover'})} />;
    case 'invite':
      return <InvitePage token={phase.token} onSignedIn={() => { navigate('clients'); start(); }} onBack={backToLogin} />;
    case 'recover':
      return <RecoveryPage onDone={() => setPhase(loginPhase(true))} onBack={backToLogin} />;
    case 'ready':
      return <CrmProvider session={phase.session} onSignOut={backToLogin}><ModalProvider><Workspace /></ModalProvider></CrmProvider>;
  }
}

function Workspace() {
  const route = parseRoute(useHash());
  switch (route.view) {
    case 'client': return <ClientPage id={route.id} tab={route.tab} />;
    case 'tasks': return <TasksPage />;
    case 'settings': return <SettingsPage />;
    case 'integrations': return <IntegrationsPage />;
    default: return <ClientsPage />;
  }
}
