const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function mailService({apiKey=process.env.RESEND_API_KEY,from=process.env.MAIL_FROM,fetcher=fetch}={}){
 const configured=()=>Boolean(apiKey&&from);
 async function sendInvitation({to,name,url,organization}){
  if(!configured())return {sent:false};
  const safeName=htmlEscape(name||'коллега'),safeOrganization=htmlEscape(organization||'GrantEd'),safeUrl=htmlEscape(url);
  const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({
   from,to:[to],subject:`Приглашение в ${organization||'GrantEd'} CRM`,
   html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171717"><h1 style="font-size:24px">Вас пригласили в ${safeOrganization}</h1><p>Здравствуйте, ${safeName}.</p><p>Создайте свой пароль и войдите в рабочее пространство CRM. Ссылка действует 7 дней и используется один раз.</p><p style="margin:28px 0"><a href="${safeUrl}" style="background:#171717;color:#fff;text-decoration:none;padding:12px 18px;border-radius:6px;display:inline-block">Принять приглашение</a></p><p style="font-size:12px;color:#666;overflow-wrap:anywhere">${safeUrl}</p><p style="font-size:12px;color:#666">Если вы не ожидали это письмо, просто проигнорируйте его.</p></div>`
  })});
  if(!response.ok)throw Error(`Почтовый сервис отклонил отправку (${response.status}).`);
  const data=await response.json();return {sent:true,id:data.id};
 }
 return {configured,sendInvitation};
}
