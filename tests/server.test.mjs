import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {createApp} from '../server/index.mjs';
test('admin, authenticated storage, CSRF, conflict and persistence',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'crm-test-'));const origin='http://127.0.0.1:4189';let app=createApp({directory:dir,origin});await new Promise(r=>app.server.listen(4189,'127.0.0.1',r));let cookie='',csrf='';
 const request=async(p,method='GET',body,extra={})=>{const r=await fetch(origin+p,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':csrf,Connection:'close',...extra},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')}};
 try{assert.equal((await request('/api/state')).status,401);const setup=await request('/api/auth/setup','POST',{email:'admin@example.com',password:'test-password-12345'});assert.equal(setup.status,200);cookie=setup.cookie.split(';')[0];csrf=setup.body.csrf;
 assert.equal((await request('/api/auth/setup','POST',{email:'admin@example.com',password:'test-password-12345'})).status,409);
 const client={id:'c1',name:'Тест',level:'PhD',year:2027,apps:[],tasks:[],docs:[]};
 assert.equal((await request('/api/state','PUT',{clients:[client],revision:0},{'X-CSRF-Token':'wrong'})).status,403);
 assert.equal((await request('/api/state','PUT',{clients:[client],revision:0})).status,200);
 assert.equal((await request('/api/state','PUT',{clients:[],revision:0})).status,409);
 assert.equal((await request('/api/state')).body.clients[0].name,'Тест');
 assert.equal((await request('/api/state','PUT',{clients:[{...client,name:''}],revision:1})).status,400);
 await new Promise(r=>app.server.close(r));app=createApp({directory:dir,origin});await new Promise(r=>app.server.listen(4189,'127.0.0.1',r));assert.equal((await request('/api/state')).body.clients.length,1);
 await request('/api/auth/logout','POST');assert.equal((await request('/api/state')).status,401);
 }finally{await new Promise(r=>app.server.close(r));rmSync(dir,{recursive:true,force:true})}
});
