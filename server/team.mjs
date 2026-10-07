import {token,digest,passwordHash,passwordMatches} from './security.mjs';
import {fail} from './validation.mjs';

const LIMIT=10,INVITE_TTL=7*24*60*60*1000;
const validEmail=value=>typeof value==='string'&&/^\S+@\S+\.\S+$/.test(value)&&value.length<=254;

export function teamService(store,origin,mailer){const {db}=store;
 db.exec(`CREATE TABLE IF NOT EXISTS staff(
  id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','disabled')),created_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS invitations(
  id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,expires INTEGER NOT NULL,sent_at TEXT
 );`);
 const clean=()=>db.prepare('DELETE FROM invitations WHERE expires<=?').run(Date.now());
 const activeCount=()=>db.prepare("SELECT count(*) AS n FROM staff WHERE status='active'").get().n;
 const pendingCount=()=>{clean();return db.prepare('SELECT count(*) AS n FROM invitations').get().n};
 const seats=()=>activeCount()+pendingCount();
 const publicStaff=()=>db.prepare('SELECT id,email,name,status,created_at AS createdAt FROM staff ORDER BY status,email').all();
 const publicInvites=()=>{clean();return db.prepare('SELECT id,email,name,created_at AS createdAt,expires,sent_at AS sentAt FROM invitations ORDER BY created_at DESC').all()};
 async function invite(data,organization='GrantEd'){
  const email=typeof data.email==='string'?data.email.trim().toLowerCase():'',name=typeof data.name==='string'?data.name.trim():'';
  if(!validEmail(email)||!name||name.length>100)fail('Проверьте имя и email сотрудника.');
  if(db.prepare('SELECT id FROM admin WHERE email=?').get(email))fail('Владелец уже использует эту почту.',409);
  if(db.prepare('SELECT id FROM staff WHERE email=?').get(email))fail('Сотрудник с такой почтой уже существует.',409);
  const existing=db.prepare('SELECT id FROM invitations WHERE email=?').get(email);clean();
  if(!existing&&seats()>=LIMIT)fail('Достигнут лимит: 10 сотрудников.',409);
  const secret=token(),id=existing?.id||token(),createdAt=new Date().toISOString(),expires=Date.now()+INVITE_TTL;
  db.prepare(`INSERT INTO invitations(id,email,name,token_hash,created_at,expires,sent_at) VALUES(?,?,?,?,?,?,NULL)
   ON CONFLICT(email) DO UPDATE SET name=excluded.name,token_hash=excluded.token_hash,created_at=excluded.created_at,expires=excluded.expires,sent_at=NULL`).run(id,email,name,digest(secret),createdAt,expires);
  const url=`${origin}/#invite/${secret}`;let delivery={sent:false},warning='';
  try{delivery=await mailer.sendInvitation({to:email,name,url,organization});if(delivery.sent)db.prepare('UPDATE invitations SET sent_at=? WHERE id=?').run(new Date().toISOString(),id)}catch(error){warning=error.message}
  store.audit('staff_invited',email);return {id,email,name,expires,inviteUrl:url,sent:delivery.sent,warning};
 }
 function inspect(secret){if(typeof secret!=='string'||secret.length>200)fail('Приглашение недействительно.',400);clean();const row=db.prepare('SELECT email,name,expires FROM invitations WHERE token_hash=?').get(digest(secret));if(!row)fail('Приглашение истекло или было отозвано.',404);const settings=JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='settings'").get()?.value||'{"organization":"GrantEd"}');return {...row,organization:settings.organization||'GrantEd'}}
 async function accept(data){const invite=inspect(data.token);const name=typeof data.name==='string'?data.name.trim():invite.name,password=data.password;
  if(!name||name.length>100)fail('Укажите имя сотрудника.');if(typeof password!=='string'||password.length<12||password.length>256)fail('Пароль должен содержать от 12 до 256 символов.');
  const hash=await passwordHash(password),id=token();db.exec('BEGIN IMMEDIATE');try{const row=db.prepare('SELECT * FROM invitations WHERE token_hash=? AND expires>?').get(digest(data.token),Date.now());if(!row)fail('Приглашение уже использовано или истекло.',409);if(activeCount()>=LIMIT)fail('В команде уже 10 сотрудников.',409);db.prepare("INSERT INTO staff(id,email,name,password_hash,status,created_at) VALUES(?,?,?,?, 'active',?)").run(id,row.email,name,hash,new Date().toISOString());db.prepare('DELETE FROM invitations WHERE id=?').run(row.id);store.audit('staff_joined',row.email);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}return {id,email:invite.email,name,role:'staff'}
 }
 function list(){return {limit:LIMIT,used:seats(),mailConfigured:mailer.configured(),staff:publicStaff(),invitations:publicInvites()}}
 function revoke(id){const row=db.prepare('SELECT email FROM invitations WHERE id=?').get(id);if(!row)fail('Приглашение не найдено.',404);db.prepare('DELETE FROM invitations WHERE id=?').run(id);store.audit('staff_invite_revoked',row.email);return list()}
 function setStatus(id,status){if(!['active','disabled'].includes(status))fail('Неизвестный статус.');const row=db.prepare('SELECT * FROM staff WHERE id=?').get(id);if(!row)fail('Сотрудник не найден.',404);if(status==='active'&&row.status!=='active'&&seats()>=LIMIT)fail('Достигнут лимит: 10 сотрудников.',409);db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE staff SET status=? WHERE id=?').run(status,id);if(status==='disabled')db.prepare("DELETE FROM sessions WHERE actor_type='staff' AND actor_id=?").run(id);store.audit(status==='active'?'staff_enabled':'staff_disabled',row.email);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}return list()}
 async function authenticate(email,password){const row=db.prepare("SELECT * FROM staff WHERE email=? AND status='active'").get(email);return row&&await passwordMatches(password,row.password_hash)?{id:row.id,email:row.email,name:row.name,role:'staff'}:null}
 function getStaff(id){return db.prepare("SELECT id,email,name,status FROM staff WHERE id=? AND status='active'").get(id)}
 async function changePassword(id,currentPassword,newPassword){if(typeof newPassword!=='string'||newPassword.length<12||newPassword.length>256)fail('Пароль должен содержать от 12 до 256 символов.');const row=getStaff(id);if(!row){fail('Сотрудник не найден.',404)}const secret=db.prepare('SELECT password_hash FROM staff WHERE id=?').get(id);if(typeof currentPassword!=='string'||currentPassword.length>256||!await passwordMatches(currentPassword,secret.password_hash))fail('Неверный текущий пароль.',401);const hash=await passwordHash(newPassword);db.exec('BEGIN IMMEDIATE');try{db.prepare('UPDATE staff SET password_hash=? WHERE id=?').run(hash,id);db.prepare("DELETE FROM sessions WHERE actor_type='staff' AND actor_id=?").run(id);store.audit('staff_password_changed',row.email);db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}}
 return {list,invite,inspect,accept,revoke,setStatus,authenticate,getStaff,changePassword};
}
