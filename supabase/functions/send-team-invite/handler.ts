interface RpcClient {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{data: unknown; error: {message: string} | null}>;
}
export interface InvitationDependencies {
  supabase: RpcClient;
  siteUrl?: string;
  resendKey?: string;
  from?: string;
  fetch: typeof fetch;
}
interface Invitation {id: string; email: string; name: string; token: string}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'})[character]!);
const response = (body: Record<string, unknown>, status = 200) => Response.json(body, {status});

function inviteUrl(site: string | undefined, token: string) {
  if (!site) return '';
  try {
    const url = new URL(site);
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) return '';
    url.hash = `invite/${token}`;
    return url.toString();
  } catch { return ''; }
}

/** Authentication and CORS run in withSupabase; owner authorization lives in RPC. */
export async function handleInvitation(request: Request, deps: InvitationDependencies): Promise<Response> {
  if (request.method !== 'POST') return response({error: 'Метод не поддерживается.'}, 405);
  let body: {email?: unknown; name?: unknown; token?: unknown};
  try {
    body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
  } catch { return response({error: 'Некорректный запрос.'}, 400); }
  const {data: rawInvite, error} = await deps.supabase.rpc('create_invitation', {
    p_email: typeof body.email === 'string' ? body.email : '', p_name: typeof body.name === 'string' ? body.name : '',
    p_token: typeof body.token === 'string' ? body.token : null,
  });
  if (error) return response({error: error.message}, 400);
  const invitation = rawInvite as Invitation;
  const url = inviteUrl(deps.siteUrl, invitation.token);
  const result = {email: invitation.email, token: invitation.token, inviteUrl: url, sent: false};
  if (!deps.resendKey || !deps.from || !url) {
    return response({...result, warning: 'Письмо не отправлено: настройте RESEND_API_KEY, INVITE_FROM_EMAIL и CRM_SITE_URL в Supabase Edge Function Secrets. Ссылку можно отправить вручную.'});
  }
  const {data: rawSettings, error: settingsError} = await deps.supabase.rpc('crm_settings');
  if (settingsError || !rawSettings) return response({...result, warning: 'Приглашение создано, но параметры организации не удалось получить. Письмо не отправлено.'});
  const settings = rawSettings as {organization?: unknown};
  const organization = typeof settings.organization === 'string' ? settings.organization : 'GrantEd';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(invitation.token));
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  let emailResponse: Response;
  try {
    emailResponse = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: {Authorization: `Bearer ${deps.resendKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `crm-invite-${invitation.id}-${hash}`},
      body: JSON.stringify({from: deps.from, to: [invitation.email], subject: `Приглашение в CRM ${organization}`,
        html: `<!doctype html><html lang="ru"><body style="font-family:Arial,sans-serif"><h1>Приглашение в ${escapeHtml(organization)}</h1><p>Здравствуйте, ${escapeHtml(invitation.name)}!</p><p>Создайте аккаунт или войдите с существующим паролем. Ссылка действует 7 дней и используется один раз.</p><p><a href="${escapeHtml(url)}">Принять приглашение</a></p><p>Если вы не ожидали письмо, просто проигнорируйте его.</p></body></html>`,
        text: `Здравствуйте, ${invitation.name}!\n\nВас пригласили в CRM ${organization}. Создайте аккаунт или войдите: ${url}\n\nСсылка действует 7 дней и используется один раз.`,
      }),
    });
  } catch {
    return response({...result, warning: 'Приглашение создано, но результат почтовой отправки неизвестен. Проверьте Resend Logs; письмо могло быть принято. Ссылку можно отправить вручную.'});
  }
  if (!emailResponse.ok) return response({...result, warning: `Письмо не отправлено: Resend отклонил запрос (HTTP ${emailResponse.status}). Проверьте API-ключ, подтверждённый домен отправителя и ограничения аккаунта Resend.`});
  const {error: markError} = await deps.supabase.rpc('mark_invitation_sent', {p_id: invitation.id, p_token: invitation.token});
  return response({...result, sent: true, ...(markError ? {warning: 'Письмо принято Resend, но статус приглашения не записан. Приглашение могло быть заменено, отозвано или принято; обновите список команды.'} : {})});
}
