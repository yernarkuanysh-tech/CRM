import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

interface Invitation {
  id: string;
  email: string;
  name: string;
  token: string;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
})[character]!);

function inviteUrl(token: string) {
  const configured = Deno.env.get("CRM_SITE_URL");
  if (!configured) return "";
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) return "";
    url.hash = `invite/${token}`;
    return url.toString();
  } catch {
    return "";
  }
}

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {status});
}

export default {
  fetch: withSupabase({auth: "user"}, async (request, context) => {
    if (request.method !== "POST") return response({error: "Метод не поддерживается."}, 405);

    let body: {email?: unknown; name?: unknown};
    try {
      body = await request.json();
    } catch {
      return response({error: "Некорректный запрос."}, 400);
    }

    const email = typeof body.email === "string" ? body.email : "";
    const name = typeof body.name === "string" ? body.name : "";
    const {data: created, error: createError} = await context.supabase.rpc("create_invitation", {p_email: email, p_name: name});
    if (createError) return response({error: createError.message}, 400);

    const invitation = created as Invitation;
    const url = inviteUrl(invitation.token);
    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("INVITE_FROM_EMAIL");
    const result = {email: invitation.email, token: invitation.token, inviteUrl: url, sent: false};

    if (!apiKey || !from || !url) {
      return response({...result, warning: "Почтовая отправка ещё не настроена. Скопируйте ссылку сотруднику вручную."});
    }

    const {data: rawSettings} = await context.supabase.rpc("crm_settings");
    const settings = rawSettings as {organization?: unknown} | null;
    const organization = typeof settings?.organization === "string" ? settings.organization : "GrantEd";
    const safeName = escapeHtml(invitation.name);
    const safeOrganization = escapeHtml(organization);
    const safeUrl = escapeHtml(url);
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json"},
      body: JSON.stringify({
        from,
        to: [invitation.email],
        subject: `Приглашение в CRM ${organization}`,
        html: `<!doctype html><html lang="ru"><body style="margin:0;background:#f5f5f5;font-family:Arial,sans-serif;color:#171717"><div style="max-width:560px;margin:0 auto;padding:40px 20px"><div style="background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:32px"><h1 style="font-size:24px;margin:0 0 20px">Приглашение в ${safeOrganization}</h1><p>Здравствуйте, ${safeName}!</p><p>Вас пригласили в команду CRM. Перейдите по кнопке и создайте личный пароль. Ссылка действует 7 дней и используется один раз.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#171717;color:#fff;text-decoration:none;border-radius:6px;padding:12px 18px">Принять приглашение</a></p><p style="font-size:12px;color:#666;word-break:break-all">Если кнопка не открывается, скопируйте ссылку:<br>${safeUrl}</p><p style="font-size:12px;color:#666">Если вы не ожидали это письмо, просто проигнорируйте его.</p></div></div></body></html>`,
        text: `Здравствуйте, ${invitation.name}!\n\nВас пригласили в команду CRM ${organization}. Создайте личный пароль по ссылке: ${url}\n\nСсылка действует 7 дней и используется один раз.`,
      }),
    });

    if (!emailResponse.ok) {
      return response({...result, warning: "Почтовый сервис не принял письмо. Скопируйте ссылку сотруднику вручную."});
    }

    const {error: markError} = await context.supabase.rpc("mark_invitation_sent", {p_id: invitation.id});
    return response({...result, sent: true, warning: markError ? "Письмо отправлено, но статус отправки не записан в CRM." : undefined});
  }),
};
