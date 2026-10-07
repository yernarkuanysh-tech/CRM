import http from 'node:http';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {adminService} from './admin.mjs';
import {googleService} from './google.mjs';
import {mailService} from './mailer.mjs';
import {teamService} from './team.mjs';
import {openStore} from './store.mjs';
import {token,digest,passwordHash,passwordMatches,safeEqual} from './security.mjs';
import {validateClients,fail} from './validation.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export function createApp({directory=path.join(root,'data'),origin='http://127.0.0.1:4173',mailer:mailerOverride}={}){
 const store=openStore(directory),{db}=store,attempts=new Map();
 store.backup();
 const google=googleService(store,origin),admin=adminService(store),mailer=mailerOverride||mailService(),team=teamService(store,origin,mailer);
 const timer=setInterval(()=>{try{store.backup()}catch(error){console.error('Backup failed',error.message)}},3600000);timer.unref();
 const server=http.createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data))};
  const setSession=user=>{const secret=token(),csrf=token();db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT INTO sessions(token_hash,csrf,expires,actor_type,actor_id) VALUES(?,?,?,?,?)').run(digest(secret),csrf,Date.now()+12*3600000,user.role==='owner'?'owner':'staff',user.id);res.setHeader('Set-Cookie',`crm_session=${secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${origin.startsWith('https:')?'; Secure':''}`);return csrf};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  try{
   const url=new URL(req.url,origin),p=url.pathname,mutating=!['GET','HEAD'].includes(req.method);
   const cookie=(req.headers.cookie||'').split(';').map(value=>value.trim()).find(value=>value.startsWith('crm_session='))?.slice(12)||'';
   let session=db.prepare('SELECT * FROM sessions WHERE token_hash=? AND expires>?').get(digest(cookie),Date.now()),currentUser=null;
   if(session?.actor_type==='staff'){
    const staff=team.getStaff(session.actor_id);if(staff)currentUser={id:staff.id,email:staff.email,name:staff.name,role:'staff'};else session=null;
   }else if(session){const owner=db.prepare('SELECT email FROM admin WHERE id=1').get(),settings=admin.status();if(owner)currentUser={id:'owner',email:owner.email,name:settings.name,role:'owner'};else session=null}
   const body=async()=>{let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8*1024*1024)fail('Слишком большой запрос.',413)}try{return JSON.parse(raw||'{}')}catch{fail('Некорректный JSON.')}};
   const limit=(key,max=10)=>{let value=attempts.get(key);if(!value||value.until<Date.now()){value={count:0,until:Date.now()+900000};attempts.set(key,value)}if(++value.count>max)fail('Слишком много попыток. Повторите через 15 минут.',429);return key};
   const ownerOnly=()=>{if(currentUser?.role!=='owner')fail('Это действие доступно только владельцу.',403)};

   if(p==='/api/auth/status'&&req.method==='GET')return send(200,{initialized:!!db.prepare('SELECT id FROM admin').get(),authenticated:!!session,csrf:session?.csrf,user:currentUser});
   if(p==='/api/auth/invite'&&req.method==='GET')return send(200,team.inspect(url.searchParams.get('token')));
   if(p==='/api/auth/accept-invite'&&req.method==='POST'){
    const key=limit('invite-'+req.socket.remoteAddress),user=await team.accept(await body());attempts.delete(key);const csrf=setSession(user);return send(200,{csrf,user});
   }
   if(p==='/api/auth/recover'&&req.method==='POST'){limit('recover-'+req.socket.remoteAddress);await admin.reset(await body());return send(200,{ok:true})}
   if(['/api/auth/setup','/api/auth/login'].includes(p)&&req.method==='POST'){
    const key=limit('login-'+req.socket.remoteAddress),data=await body(),email=typeof data.email==='string'?data.email.trim().toLowerCase():'',password=data.password;
    if(!/^\S+@\S+\.\S+$/.test(email)||typeof password!=='string'||password.length>256)fail('Проверьте почту и пароль.');
    let user;
    if(p.endsWith('/setup')){
     if(db.prepare('SELECT id FROM admin').get())fail('Владелец уже создан.',409);if(password.length<12)fail('Пароль должен содержать минимум 12 символов.');db.prepare('INSERT INTO admin VALUES(1,?,?)').run(email,await passwordHash(password));store.audit('admin_created');user={id:'owner',email,name:admin.status().name,role:'owner'};
    }else{
     const owner=db.prepare('SELECT * FROM admin WHERE id=1').get();if(owner?.email===email&&await passwordMatches(password,owner.password_hash))user={id:'owner',email:owner.email,name:admin.status().name,role:'owner'};else user=await team.authenticate(email,password);if(!user)fail('Неверная почта или пароль.',401);
    }
    attempts.delete(key);return send(200,{csrf:setSession(user),user});
   }
   if(p==='/oauth/google/callback'&&req.method==='GET'){if(!session)fail('Войдите в CRM и повторите подключение.',401);const target=await google.callback(url.searchParams,digest(cookie));res.writeHead(303,{Location:'/#'+target});return res.end()}

   if(p.startsWith('/api/')){
    if(!session)fail('Войдите в CRM.',401);if(mutating&&!safeEqual(req.headers['x-csrf-token'],session.csrf))fail('Сессия изменилась. Обновите страницу.',403);
    if(p==='/api/auth/logout'&&req.method==='POST'){db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(cookie));res.setHeader('Set-Cookie','crm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');return send(200,{ok:true})}
    if(['/api/auth/password','/api/auth/recovery-code'].includes(p)&&req.method==='POST')limit('security-'+session.token_hash);
    if(p==='/api/settings'&&req.method==='GET'){
     const settings=admin.status(),teamCount=team.list().used;
     return send(200,currentUser.role==='owner'?{...settings,currentUser,teamCount}:{organization:settings.organization,year:settings.year,currentUser,teamCount});
    }
    if(p==='/api/settings'&&req.method==='PUT'){ownerOnly();return send(200,admin.update(await body()))}
    if(p==='/api/auth/recovery-code'&&req.method==='POST'){ownerOnly();const data=await body();return send(200,{code:await admin.recovery(data.currentPassword)})}
    if(p==='/api/auth/password'&&req.method==='POST'){
     const data=await body();if(currentUser.role==='owner')await admin.change(data);else await team.changePassword(currentUser.id,data.currentPassword,data.newPassword);return send(200,{ok:true});
    }
    if(p==='/api/team'&&req.method==='GET'){ownerOnly();return send(200,team.list())}
    if(p==='/api/team/invitations'&&req.method==='POST'){ownerOnly();const settings=admin.status();return send(201,await team.invite(await body(),settings.organization))}
    if(p==='/api/team/invitations/revoke'&&req.method==='POST'){ownerOnly();const data=await body();return send(200,team.revoke(data.id))}
    if(p==='/api/team/status'&&req.method==='POST'){ownerOnly();const data=await body();return send(200,team.setStatus(data.id,data.status))}
    if(p==='/api/google/status'&&req.method==='GET')return send(200,google.status());
    if(p==='/api/google/authorize'&&req.method==='POST'){ownerOnly();return send(200,{url:google.authorize(await body(),digest(cookie))})}
    if(p==='/api/google/disconnect'&&req.method==='POST'){ownerOnly();const data=await body();google.disconnect(data.owner);return send(200,{ok:true})}
    if(p==='/api/google/messages'&&req.method==='GET')return send(200,await google.messages(url.searchParams.get('client')));
    if(p==='/api/google/files'&&req.method==='GET')return send(200,await google.files(url.searchParams.get('client')));
    if(p==='/api/state'&&req.method==='GET')return send(200,store.getState());
    if(p==='/api/state'&&req.method==='PUT'){const data=await body(),previous=store.getState();validateClients(data.clients,previous.clients);return send(200,{revision:store.updateState(data.clients,data.revision)})}
    if(p==='/api/export'&&req.method==='GET'){ownerOnly();res.setHeader('Content-Disposition','attachment; filename="granted-crm.json"');return send(200,store.getState())}
    fail('Не найдено.',404);
   }

   if(!['GET','HEAD'].includes(req.method))fail('Метод недоступен.',405);
   const name=p==='/'?'index.html':p.slice(1),allowed=['index.html','favicon.svg','granted-logo-mark.jpg','granted-logo-source.jpg','app.js','reports.js','report-pdf.js','session.js','settings.js','tests.js','style.css'];
   if(!allowed.includes(name))fail('Не найдено.',404);const ext=path.extname(name);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[ext]);res.end(readFileSync(path.join(root,'dist',name)));
  }catch(error){send(error.status||500,{error:error.status?error.message:'Ошибка сервера. Данные не сохранены.'});if(!error.status)console.error(error)}
 });
 server.on('close',()=>{clearInterval(timer);db.close()});return {server,store};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||4173),host=process.env.HOST||'127.0.0.1',origin=process.env.APP_ORIGIN||`http://127.0.0.1:${port}`;
 const {server}=createApp({directory:process.env.CRM_DATA_DIR,origin});server.listen(port,host,()=>console.log(`GrantEd CRM: ${origin}`));
}
