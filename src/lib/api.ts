import {createClient} from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw Error('VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY не заданы (см. .env.example).');

// PKCE keeps auth redirects in the query string, so they never collide with the hash router.
export const supabase = createClient(url, key, {auth: {flowType: 'pkce'}});

// Supabase Auth answers in English; the UI is Russian.
const authMessages: [RegExp, string][] = [
  [/invalid login credentials/i, 'Неверная почта или пароль.'],
  [/email not confirmed/i, 'Почта не подтверждена. Откройте ссылку из письма Supabase и войдите снова.'],
  [/database error saving new user/i, 'Регистрация недоступна: владелец уже создан, а приглашение недействительно.'],
  [/user already registered/i, 'Пользователь с этой почтой уже зарегистрирован.'],
  [/rate limit|too many/i, 'Слишком много попыток. Повторите позже.'],
  [/should be different/i, 'Новый пароль должен отличаться от текущего.'],
  [/password should|weak password/i, 'Пароль слишком простой или короткий.'],
  [/failed to fetch|network/i, 'Нет связи с сервером. Проверьте подключение к интернету.'],
];

export function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error);
  return authMessages.find(([pattern]) => pattern.test(message))?.[1] ?? message;
}

/** Calls a Postgres function from supabase/migrations; its error text is already user-facing. */
export async function rpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
  const {data, error} = await supabase.rpc(name, args);
  if (error) throw Error(errorMessage(error));
  return data as T;
}

/** Throws the Supabase error, translated, when a call failed. */
export function check<T extends {error: unknown}>(result: T): T {
  if (result.error) throw Error(errorMessage(result.error));
  return result;
}

/** Page through the 1000-row API limit. */
export async function loadClients() {
  const rows: {id: string; data: unknown; revision: number}[] = [];
  for (let from = 0; ; from += 1000) {
    const {data} = check(await supabase.from('clients').select('id, data, revision').order('position', {ascending: false}).range(from, from + 999));
    rows.push(...data!);
    if (data!.length < 1000) return rows;
  }
}

/** Downloads every client card as JSON (no passwords or tokens: those never reach the browser). */
export async function downloadExport(event: {preventDefault(): void}) {
  event.preventDefault();
  const rows = await loadClients();
  const blob = new Blob([JSON.stringify({exportedAt: new Date().toISOString(), clients: rows.map(row => row.data)}, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), {href: url, download: 'granted-crm.json'}).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
