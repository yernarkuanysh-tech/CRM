import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../server/store.mjs';
import {teamService} from '../server/team.mjs';
import {mailService} from '../server/mailer.mjs';
import {passwordHash} from '../server/security.mjs';

test('staff invitation is single use, login works and disabling revokes sessions',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'crm-team-')),store=openStore(directory),sent=[];
 const mailer={configured:()=>true,async sendInvitation(message){sent.push(message);return {sent:true,id:'mail-1'}}};
 const team=teamService(store,'https://crm.example.kz',mailer);
 try{
  store.db.prepare('INSERT INTO admin VALUES(1,?,?)').run('owner@example.kz',await passwordHash('owner-password-123'));
  const invitation=await team.invite({name:'Айша Нурова',email:'aisha@example.kz'},'GrantEd');
  assert.equal(invitation.sent,true);assert.equal(sent.length,1);assert.match(invitation.inviteUrl,/^https:\/\/crm\.example\.kz\/#invite\//);
  const secret=invitation.inviteUrl.split('/').at(-1),preview=team.inspect(secret);assert.equal(preview.email,'aisha@example.kz');
  const member=await team.accept({token:secret,name:'Айша Нурова',password:'staff-password-123'});assert.equal(member.role,'staff');
  await assert.rejects(team.accept({token:secret,name:'Айша',password:'staff-password-123'}));
  assert.equal((await team.authenticate('aisha@example.kz','staff-password-123')).id,member.id);
  store.db.prepare("INSERT INTO sessions(token_hash,csrf,expires,actor_type,actor_id) VALUES('session','csrf',?,'staff',?)").run(Date.now()+10000,member.id);
  team.setStatus(member.id,'disabled');assert.equal(store.db.prepare('SELECT count(*) AS n FROM sessions WHERE actor_id=?').get(member.id).n,0);assert.equal(await team.authenticate('aisha@example.kz','staff-password-123'),null);
 }finally{store.db.close();rmSync(directory,{recursive:true,force:true})}
});

test('team limit counts active staff and pending invitations',async()=>{
 const directory=mkdtempSync(path.join(os.tmpdir(),'crm-team-limit-')),store=openStore(directory),mailer={configured:()=>false,async sendInvitation(){return {sent:false}}},team=teamService(store,'https://crm.example.kz',mailer);
 try{for(let index=0;index<10;index++)await team.invite({name:`Member ${index}`,email:`member${index}@example.kz`});assert.equal(team.list().used,10);await assert.rejects(team.invite({name:'Eleven',email:'eleven@example.kz'}),/10/)}finally{store.db.close();rmSync(directory,{recursive:true,force:true})}
});

test('Resend adapter sends escaped invitation email',async()=>{
 let request;const mailer=mailService({apiKey:'test-key',from:'GrantEd <crm@example.kz>',fetcher:async(url,options)=>{request={url,options};return {ok:true,async json(){return {id:'email-id'}}}}});
 const result=await mailer.sendInvitation({to:'staff@example.kz',name:'<Staff>',url:'https://crm.example.kz/#invite/token',organization:'GrantEd'});
 assert.equal(result.sent,true);assert.equal(request.url,'https://api.resend.com/emails');assert.equal(request.options.headers.Authorization,'Bearer test-key');assert.doesNotMatch(JSON.parse(request.options.body).html,/<Staff>/);
});
