import {useCallback, useEffect, useState} from 'react';
import {ModalProvider} from './components/feedback';
import {api, errorMessage, setCsrf} from './lib/api';
import {navigate, parseRoute, useHash} from './route';
import {CrmProvider, type Session} from './state';
import {ClientPage} from './pages/ClientPage';
import {ClientsPage} from './pages/ClientsPage';
import {IntegrationsPage} from './pages/IntegrationsPage';
import {InvitePage, LoginPage, RecoveryPage} from './pages/AuthPages';
import {SettingsPage} from './pages/SettingsPage';
import {TasksPage} from './pages/TasksPage';
import type {Client, Settings, User} from './types';

type Phase =
  | {kind: 'loading'}
  | {kind: 'error'; message: string}
  | {kind: 'login'; initialized: boolean}
  | {kind: 'invite'; token: string}
  | {kind: 'recover'}
  | {kind: 'ready'; session: Session};

interface AuthStatus {
  initialized: boolean;
  authenticated: boolean;
  csrf?: string;
  user: User | null;
}

const loginPhase = (initialized: boolean): Phase => {
  const invite = (location.hash || '').match(/^#invite\/(.+)$/);
  return invite ? {kind: 'invite', token: invite[1]} : {kind: 'login', initialized};
};

export function App() {
  const [phase, setPhase] = useState<Phase>({kind: 'loading'});

  const start = useCallback(async () => {
    try {
      const status = await api<AuthStatus>('/api/auth/status');
      if (!status.authenticated) {
        setPhase(loginPhase(status.initialized));
        return;
      }
      setCsrf(status.csrf);
      const settings = await api<Settings>('/api/settings');
      const state = await api<{clients: Client[]; revision: number}>('/api/state');
      setPhase({kind: 'ready', session: {user: status.user ?? settings.currentUser!, settings, clients: state.clients, revision: state.revision}});
    } catch (error) {
      setPhase({kind: 'error', message: errorMessage(error)});
    }
  }, []);

  useEffect(() => { start(); }, [start]);

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
