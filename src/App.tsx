import {useCallback, useEffect, useState} from 'react';
import {ModalProvider} from './components/feedback';
import {errorMessage, loadClients, rpc, supabase} from './lib/api';
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

  const start = useCallback(async () => {
    try {
      const {data: {session}} = await supabase.auth.getSession();
      const settings = session && await rpc<Settings | null>('crm_settings');
      if (!settings) {
        // No session, or the account has no active CRM access (e.g. disabled by the owner).
        if (session) await supabase.auth.signOut({scope: 'local'});
        setPhase(loginPhase(await rpc<boolean>('crm_initialized')));
        return;
      }
      const rows = await loadClients();
      setPhase({kind: 'ready', session: {
        user: settings.currentUser!, settings,
        clients: rows.map(row => row.data as Client),
        revisions: Object.fromEntries(rows.map(row => [row.id, row.revision])),
      }});
    } catch (error) {
      setPhase({kind: 'error', message: errorMessage(error)});
    }
  }, []);

  useEffect(() => { start(); }, [start]);

  // Signing out in another tab, or an expired refresh token, returns this tab to the login page.
  useEffect(() => {
    const {data} = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT') setPhase(phase => phase.kind === 'ready' ? loginPhase(true) : phase);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const backToLogin = useCallback(() => {
    navigate('');
    setPhase(loginPhase(true));
  }, []);

  switch (phase.kind) {
    case 'loading':
      return null;
    case 'error':
      return <>Не удалось подключиться к серверу: {phase.message}</>;
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
