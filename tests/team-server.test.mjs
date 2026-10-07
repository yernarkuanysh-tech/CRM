import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../server/index.mjs';

test('owner invites staff; staff signs in and owner can disable access',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'crm-team-http-')),origin='http://127.0.0.1:4201',sent=[];
 const mailer={configured:()=>true,async sendInvitation(message){sent.push(message);return {sent:true,id:'mail'}}};
 const app=createApp({directory,origin,mailer});await new Promise(resolve=>app.server.listen(4201,'127.0.0.1',resolve));
 const request=async(pathname,{method='GET',body,cookie='',csrf=''}={})=>{const response=await fetch(origin+pathname,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')}};
 try{
  const setup=await request('/api/auth/setup',{method:'POST',body:{email:'owner@example.kz',password:'owner-password-123'}}),ownerCookie=setup.cookie.split(';')[0],ownerCsrf=setup.body.csrf;
  const invitation=await request('/api/team/invitations',{method:'POST',cookie:ownerCookie,csrf:ownerCsrf,body:{name:'Dana Staff',email:'dana@example.kz'}});assert.equal(invitation.status,201);assert.equal(invitation.body.sent,true);assert.equal(sent.length,1);
  const secret=new URL(sent[0].url).hash.split('/').at(-1),preview=await request('/api/auth/invite?token='+encodeURIComponent(secret));assert.equal(preview.body.email,'dana@example.kz');
  const accepted=await request('/api/auth/accept-invite',{method:'POST',body:{token:secret,name:'Dana Staff',password:'staff-password-123'}}),staffCookie=accepted.cookie.split(';')[0],staffCsrf=accepted.body.csrf;assert.equal(accepted.body.user.role,'staff');
  assert.equal((await request('/api/state',{cookie:staffCookie,csrf:staffCsrf})).status,200);assert.equal((await request('/api/team',{cookie:staffCookie,csrf:staffCsrf})).status,403);
  const team=await request('/api/team',{cookie:ownerCookie,csrf:ownerCsrf}),staffId=team.body.staff[0].id;assert.equal((await request('/api/team/status',{method:'POST',cookie:ownerCookie,csrf:ownerCsrf,body:{id:staffId,status:'disabled'}})).status,200);assert.equal((await request('/api/state',{cookie:staffCookie,csrf:staffCsrf})).status,401);
 }finally{await new Promise(resolve=>app.server.close(resolve));rmSync(directory,{recursive:true,force:true})}
});
