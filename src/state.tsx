import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction} from 'react';
import {createPortal} from 'react-dom';
import {errorMessage, rpc} from './lib/api';
import {useToast} from './components/feedback';
import type {Client, Settings, User} from './types';

export interface Session {
  user: User;
  settings: Settings;
  clients: Client[];
  /** Server revision of each client card, for optimistic concurrency. */
  revisions: Record<string, number>;
}

export interface ListState {
  query: string;
  level: string;
  stage: string;
  page: number;
}

interface CrmValue {
  user: User;
  setUser: Dispatch<SetStateAction<User>>;
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  clients: Client[];
  clientById(id?: string): Client | undefined;
  /** Persists the full client list (only changed cards are sent). Returns false (and shows the alert) when the server rejects it. */
  save(next: Client[]): Promise<boolean>;
  /** Applies `recipe` to a copy of the client and saves. Errors thrown by `recipe` propagate. */
  updateClient(id: string, recipe: (draft: Client) => void): Promise<boolean>;
  list: ListState;
  setList: Dispatch<SetStateAction<ListState>>;
  selectedReportId: string | null;
  setSelectedReportId: Dispatch<SetStateAction<string | null>>;
  signOut(): void;
}

const CrmContext = createContext<CrmValue | null>(null);

export function useCrm() {
  const value = useContext(CrmContext);
  if (!value) throw Error('useCrm must be used inside <CrmProvider>');
  return value;
}

export function CrmProvider({session, onSignOut, children}: {session: Session; onSignOut(): void; children: ReactNode}) {
  const toast = useToast();
  const [user, setUser] = useState(session.user);
  const [settings, setSettings] = useState(session.settings);
  const [clients, setClients] = useState(session.clients);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [list, setList] = useState<ListState>({query: '', level: '', stage: '', page: 1});
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const clientsRef = useRef(clients), revisions = useRef(session.revisions), savingRef = useRef(false);

  useEffect(() => {
    document.body.classList.toggle('saving', saving);
  }, [saving]);

  const save = useCallback(async (next: Client[]) => {
    if (savingRef.current) {
      toast('Дождитесь завершения сохранения.');
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const previous = new Map(clientsRef.current.map(c => [c.id, c])), kept = new Set(next.map(c => c.id));
      const upserts = next
        .filter(c => !previous.has(c.id) || JSON.stringify(previous.get(c.id)) !== JSON.stringify(c))
        .map(c => ({data: c, revision: previous.has(c.id) ? revisions.current[c.id] : null}));
      const deletes = [...previous.keys()].filter(id => !kept.has(id)).map(id => ({id, revision: revisions.current[id]}));
      if (upserts.length || deletes.length) {
        const saved = await rpc<Record<string, number>>('save_clients', {p_upserts: upserts, p_deletes: deletes});
        const nextRevisions = {...revisions.current, ...saved};
        for (const {id} of deletes) delete nextRevisions[id];
        revisions.current = nextRevisions;
      }
      clientsRef.current = next;
      setClients(next);
      setSaveError('');
      return true;
    } catch (error) {
      setSaveError('Изменения НЕ сохранены. ' + errorMessage(error) + ' Скопируйте введённый текст перед обновлением страницы.');
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [toast]);

  const updateClient = useCallback(async (id: string, recipe: (draft: Client) => void) => {
    const current = clientsRef.current, index = current.findIndex(c => c.id === id);
    if (index < 0) throw Error('Клиент не найден.');
    const draft = structuredClone(current[index]);
    recipe(draft);
    return save(current.map((c, i) => i === index ? draft : c));
  }, [save]);

  const clientById = useCallback((id?: string) => clients.find(c => c.id === id), [clients]);

  // Read-only client search for in-browser agents (WebMCP), when the browser supports it.
  useEffect(() => {
    const modelContext = (document as Document & {modelContext?: {registerTool?(tool: unknown): unknown}}).modelContext;
    if (!modelContext?.registerTool) return;
    try {
      Promise.resolve(modelContext.registerTool({
        name: 'search_applicants',
        title: 'Поиск клиентов CRM',
        description: 'Найти клиентов по имени или email в демонстрационной CRM. Только чтение.',
        inputSchema: {type: 'object', properties: {query: {type: 'string'}}, required: ['query'], additionalProperties: false},
        annotations: {readOnlyHint: true, untrustedContentHint: true},
        execute(input: {query?: unknown}) {
          if (!input || typeof input.query !== 'string') throw new Error('query must be a string');
          const query = input.query.toLowerCase();
          return clientsRef.current.filter(c => `${c.name} ${c.email}`.toLowerCase().includes(query)).slice(0, 20).map(c => ({id: c.id, name: c.name, level: c.level, applications: c.apps.length}));
        },
      })).catch(() => {});
    } catch { /* registration is best-effort */ }
  }, []);

  const value = useMemo<CrmValue>(() => ({
    user, setUser, settings, setSettings, clients, clientById, save, updateClient,
    list, setList, selectedReportId, setSelectedReportId, signOut: onSignOut,
  }), [user, settings, clients, clientById, save, updateClient, list, selectedReportId, onSignOut]);

  return (
    <CrmContext.Provider value={value}>
      {children}
      {saveError && createPortal(<div id="save-error" role="alert" className="fixed inset-x-0 bottom-0 z-10000 bg-[#fff0ef] p-20 text-[#9c2020]">{saveError}</div>, document.body)}
    </CrmContext.Provider>
  );
}
