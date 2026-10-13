export interface InviteResult {
  email: string;
  token: string;
  inviteUrl: string;
  sent: boolean;
  warning?: string;
}

export function newInvitationToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A transport failure may occur AFTER the server created or mailed an invitation. */
export class FunctionRequestUncertainError extends Error {}
export class FunctionUnavailableError extends Error {}

export function classifyFunctionError(error: {name?: string; message?: string; context?: unknown}) {
  if (error.context instanceof Response && error.context.status === 404) {
    return new FunctionUnavailableError('Функция отправки не опубликована.');
  }
  if (['FunctionsFetchError', 'FunctionsRelayError'].includes(error.name || '')
      || /failed to send a request to the edge function/i.test(error.message || '')) {
    return new FunctionRequestUncertainError('Не удалось подтвердить результат отправки. Обновите список команды перед повтором. Проверьте соединение и настройки Edge Function.');
  }
  return null;
}

export async function sendInvitation(input: {email: string; name: string; token: string}, deps: {
  invoke(input: {email: string; name: string; token: string}): Promise<InviteResult>;
  create(input: {email: string; name: string; token: string}): Promise<{email: string; token: string}>;
  siteUrl: string;
}): Promise<InviteResult> {
  let result: InviteResult;
  try {
    result = await deps.invoke(input);
  } catch (error) {
    // Only a definite missing function is safe to replace with a manual invitation.
    if (!(error instanceof FunctionUnavailableError)) throw error;
    const created = await deps.create(input);
    result = {...created, inviteUrl: '', sent: false, warning: 'Функция отправки не опубликована. Отправьте ссылку сотруднику вручную.'};
  }
  const url = new URL(deps.siteUrl);
  url.hash = `invite/${result.token}`;
  return {...result, inviteUrl: result.inviteUrl || url.toString()};
}
