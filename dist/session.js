let crmCsrf='',crmRevision=0,crmReady=false,crmSaving=false,crmUser=null;

async function api(url,options={}){
 const res=await fetch(url,{...options,headers:{'Content-Type':'application/json','X-CSRF-Token':crmCsrf,...options.headers}});
 const data=await res.json();if(!res.ok)throw Error(data.error||'Ошибка запроса');return data;
}

async function startCRM(){
 try{
  const status=await api('/api/auth/status');
  if(!status.authenticated){await showLogin(status.initialized);return}
  crmCsrf=status.csrf;crmUser=status.user;crmSettings=await api('/api/settings');
  const state=await api('/api/state');clients=state.clients;crmRevision=state.revision;crmReady=true;render();
 }catch(error){document.querySelector('#app').textContent='Не удалось подключиться к серверу: '+error.message}
}

async function showInvite(token){
 crmReady=false;
 try{
  const invite=await api('/api/auth/invite?token='+encodeURIComponent(token));
  document.querySelector('#app').innerHTML=`<main class="login-page invite-page"><div class="login-brand">${brandLogo()}</div><p class="eyebrow">Приглашение в команду</p><h1>Присоединиться к ${esc(invite.organization)}</h1><p>Приглашение отправлено на <strong>${esc(invite.email)}</strong>. Создайте личный пароль для входа.</p><form id="invite-form"><label>Ваше имя<input name="name" required maxlength="100" value="${esc(invite.name)}" autocomplete="name"></label><label>Новый пароль<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="new-password"></label><label>Повторите пароль<input name="confirmPassword" type="password" required minlength="12" maxlength="256" autocomplete="new-password"></label><p id="invite-error" role="alert"></p><button class="primary">Принять приглашение</button></form><p class="subtle">Ссылка действует один раз. Не пересылайте её другим людям.</p></main>`;
  document.querySelector('#invite-form').onsubmit=async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.target)),button=event.target.querySelector('button');button.disabled=true;try{if(data.password!==data.confirmPassword)throw Error('Пароли не совпадают.');const result=await api('/api/auth/accept-invite',{method:'POST',body:JSON.stringify({token,name:data.name,password:data.password})});crmCsrf=result.csrf;crmUser=result.user;location.hash='clients';await startCRM()}catch(error){document.querySelector('#invite-error').textContent=error.message}finally{button.disabled=false}};
 }catch(error){document.querySelector('#app').innerHTML=`<main class="login-page"><div class="login-brand">${brandLogo()}</div><h1>Приглашение недоступно</h1><p>${esc(error.message)}</p><button class="primary" data-back-login>Вернуться ко входу</button></main>`}
}

async function showLogin(initialized){
 const invite=(location.hash||'').match(/^#invite\/(.+)$/);if(invite)return showInvite(invite[1]);
 crmReady=false;crmUser=null;
 document.querySelector('#app').innerHTML=`<main class="login-page"><div class="login-brand">${brandLogo()}</div><h1>${initialized?'Вход в CRM':'Создание владельца'}</h1><p>${initialized?'Войдите со своей рабочей почтой.':'Создайте учётную запись владельца рабочего пространства.'}</p><form id="login-form"><label>Почта<input name="email" type="email" required autocomplete="username"></label><label>Пароль<input name="password" type="password" required minlength="${initialized?1:12}" maxlength="256" autocomplete="${initialized?'current-password':'new-password'}"></label><p id="login-error" role="alert"></p><button class="primary">${initialized?'Войти':'Создать и войти'}</button></form>${initialized?'<p><button type="button" data-recover>Забыли пароль владельца?</button></p>':''}<p class="subtle">Каждый сотрудник входит под своей учётной записью.</p></main>`;
 document.querySelector('#login-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{await api('/api/auth/'+(initialized?'login':'setup'),{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});await startCRM()}catch(error){document.querySelector('#login-error').textContent=error.message}finally{button.disabled=false}};
}

async function serverSave(){
 if(crmSaving){toast('Дождитесь завершения сохранения.');return false}crmSaving=true;document.body.classList.add('saving');
 try{const result=await api('/api/state',{method:'PUT',body:JSON.stringify({clients,revision:crmRevision})});crmRevision=result.revision;document.querySelector('#save-error')?.remove();return true}
 catch(error){let alert=document.querySelector('#save-error');if(!alert){alert=document.createElement('div');alert.id='save-error';alert.setAttribute('role','alert');alert.style='position:fixed;bottom:0;left:0;right:0;padding:20px;background:#fff0ef;color:#9c2020;z-index:10000';document.body.append(alert)}alert.textContent='Изменения НЕ сохранены. '+error.message+' Скопируйте введённый текст перед обновлением страницы.';return false}
 finally{crmSaving=false;document.body.classList.remove('saving')}
}

document.addEventListener('click',async event=>{
 const action=event.target.closest('[data-session]')?.dataset.session;if(!action)return;
 try{
  if(action==='logout'){await api('/api/auth/logout',{method:'POST'});clients=[];location.hash='';showLogin(true)}
  if(action==='import'){const raw=localStorage.getItem(KEY);if(!raw){toast('Данных прототипа в этом браузере нет.');return}const imported=JSON.parse(raw);if(!Array.isArray(imported))throw Error('Некорректный импорт');showModal('Импорт из прототипа',`<p>Будет перенесено ${imported.length} карточек из этого браузера, включая демонстрационные. Импорт доступен только в пустую базу.</p><div class="form-footer"><button data-action="close">Отмена</button><button class="primary" data-session="confirm-import">Импортировать</button></div>`)}
  if(action==='confirm-import'){if(clients.length)throw Error('База уже содержит клиентов.');clients=JSON.parse(localStorage.getItem(KEY));if(await save()){$('#modal').close();render();toast('Карточки перенесены в базу')}}
 }catch(error){toast(error.message)}
});

document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-google]');if(!button)return;const action=button.dataset.google;button.disabled=true;
 try{
  if(['drive','gmail'].includes(action)){const status=await api('/api/google/status');if(!status.configured)throw Error('Google ещё не настроен на сервере. Инструкция находится в README проекта.');showModal('Подключить Google',`<form id="google-form"><p>Выберите аккаунт владельца документов или почты. Пароль вводится только на странице Google.</p><label>Почта Google<input type="email" name="email" required value="${esc(clientById(button.dataset.client)?.email||'')}"></label><p id="google-error" role="alert"></p><button class="primary">Перейти в Google</button></form>`);$('#google-form').onsubmit=async submit=>{submit.preventDefault();try{const result=await api('/api/google/authorize',{method:'POST',body:JSON.stringify({kind:action,client:button.dataset.client,email:new FormData(submit.target).get('email')})});location.href=result.url}catch(error){$('#google-error').textContent=error.message}};return}
  if(action==='disconnect'){await api('/api/google/disconnect',{method:'POST',body:JSON.stringify({owner:button.dataset.owner})});toast('Подключение удалено из CRM.');button.remove();return}
  const result=await api('/api/google/'+action+(button.dataset.client?'?client='+encodeURIComponent(button.dataset.client):'')),area=$('#google-result');if(!area)return;
  if(action==='status')area.innerHTML=`<p>${result.configured?'Google настроен на сервере.':'Google пока не настроен на сервере.'}</p>`+result.connections.map(connection=>`<p>${esc(connection.kind)} · ${esc(connection.email)} ${crmUser?.role==='owner'?`<button data-google="disconnect" data-owner="${esc(connection.owner)}">Отключить</button>`:''}</p>`).join('');
  if(action==='messages')area.innerHTML=result.messages.map(message=>`<article class="mail"><strong>${esc(message.headers.find(header=>header.name.toLowerCase()==='subject')?.value||'Без темы')}</strong><p>${esc(message.headers.find(header=>header.name.toLowerCase()==='from')?.value||'')}</p><p>${esc(message.snippet)}</p></article>`).join('')||'<p>Писем нет.</p>';
  if(action==='files')area.innerHTML=(result.files||[]).map(file=>`<p><a href="https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view" target="_blank" rel="noopener noreferrer">${esc(file.name)}</a></p>`).join('')+(result.nextPageToken?'<p>Показаны первые 100 файлов. Все файлы доступны в папке Drive.</p>':'')||'<p>Папка пуста.</p>';
 }catch(error){toast(error.message)}finally{button.disabled=false}
});
