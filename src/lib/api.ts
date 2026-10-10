let csrf = '';

export function setCsrf(value: string | undefined) {
  csrf = value || '';
}

export async function api<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {...options, headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...options.headers}});
  const data = await res.json();
  if (!res.ok) throw Error(data.error || 'Ошибка запроса');
  return data as T;
}

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
