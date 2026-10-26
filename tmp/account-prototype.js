// ACCOUNT PROTOTYPE v3.1: memory-only interaction demo; no production authentication.
(() => {
  const orgs = new Map([
    ['terminal-demo',{id:'terminal-demo',name:'演示终端企业',parent:'distributor-demo',kind:'terminal'}],
    ['distributor-demo',{id:'distributor-demo',name:'演示二级分销',parent:'platform-demo',kind:'distributor'}],
    ['platform-demo',{id:'platform-demo',name:'演示平台',parent:null,kind:'platform'}]
  ]);
  const accounts = new Map(), secrets = new Map();
  const seedIds = {admin:'user-admin-demo',sales:'user-sales-demo',distributor:'user-distributor-demo',platform:'user-platform-demo'};
  let actor = seedIds.admin, handoff = null, serial = 0;
  const audit = [];
  const own = () => accounts.get(actor);
  const randomPassword = () => 'T-' + Array.from(crypto.getRandomValues(new Uint8Array(12)), b=>b.toString(16).padStart(2,'0')).join('');
  async function digest(password,salt){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(salt+'\n'+password))),b=>b.toString(16).padStart(2,'0')).join('')}
  async function setSecret(id,password){const salt=randomPassword();secrets.set(id,{salt,hash:await digest(password,salt)})}
  async function matches(id,password){const s=secrets.get(id);return !!s&&s.hash===await digest(password,s.salt)}
  const ready = Promise.all(Object.entries(seedIds).map(async ([role,id])=>{
    const org=role==='admin'||role==='sales'?'terminal-demo':role+'-demo';
    accounts.set(id,{id,org,login:role==='sales'?'wang@example.test':role+'@example.test',name:role==='sales'?'王敏':({admin:'终端管理员',platform:'平台管理员',distributor:'分销管理员'})[role],role,active:true,mustChange:false,seed:true});
    await setSecret(id,'Demo@2026');
  }));
  const log = (action,target) => audit.push({action,actor,target:target.id,organization:target.org,time:new Date().toISOString()});
  function allowed(){const a=own();return !!a&&a.active&&!a.mustChange&&a.seed}
  function accountError(t){const el=$('dialog').classList.contains('open')?$('modal').querySelector('#accountModalError,#accountError'):($('view').querySelector('#accountError')||$('view').querySelector('#accountPageError'));if(el)el.textContent=t;else toast(t)}
  function accountShell(title,body){$('nav').innerHTML='';$('view').innerHTML=head(title,'账号流程演示 · 信息仅保存在当前页面，刷新后恢复演示数据。')+'<section class="panel account-card">'+body+(body.includes('id="accountError"')?'':'<p id="accountError" class="error" role="alert"></p>')+'</section>';if($('currentModule'))$('currentModule').textContent=title;toolbar()}
  function toolbar(){
    let bar=$('accountTools');if(!bar){bar=document.createElement('span');bar.id='accountTools';bar.className='row';$('role').after(bar)}
    bar.innerHTML=own()?'<button class="small" onclick="accountSettings()">账号设置</button><button class="small" onclick="accountLogout()">退出登录</button>':'<span class="hint">尚未登录</span>';
    $('role').value=S.role;
    $('role').disabled=!!own()?.mustChange;
  }
  const oldRender=render,oldGo=go,oldChangeRole=changeRole,oldClose=closeModal;
  closeModal=function(){handoff=null;if($('handoffPassword'))$('handoffPassword').value='';oldClose();$('modal').innerHTML=''};
  render=function(){
    if(!own()){loginView();return}
    if(own().mustChange){forceView();return}
    if(!own().seed){accountShell('账号已就绪','<h2>'+esc(orgs.get(own().org).name)+'</h2><p>当前登录邮箱：'+esc(own().login)+'</p><p class="success">密码已设置，可以使用此账号登录。</p><p class="hint">此处仅演示新账号流程，业务数据与原有演示企业隔离。通过上方“切换演示角色”返回业务演示。</p>');return}
    oldRender();toolbar();
  };
  go=function(page){if(!allowed())return render();oldGo(page)};
  changeRole=function(role){if(own()?.mustChange)return accountError('请先完成密码修改');actor=seedIds[role];oldChangeRole(role);toolbar()};
  window.accountLogout=function(){actor=null;closeModal();render()};
  function loginView(){accountShell('登录','<form onsubmit="event.preventDefault();accountLogin()"><label>登录邮箱<input id="loginEmail" type="email" required autocomplete="username"></label><label>密码<input id="loginPassword" type="password" required autocomplete="current-password"></label><div class="actions"><button type="button" onclick="accountForgot()">忘记密码</button><button class="primary">登录</button></div></form><details><summary>演示登录说明</summary><p>已有演示邮箱：admin@example.test、wang@example.test、distributor@example.test、platform@example.test。初始演示密码：Demo@2026。也可使用上方角色选择器返回演示身份。</p></details>')}
  window.accountLogin=async function(){await ready;const email=$('loginEmail').value,password=$('loginPassword').value;const a=[...accounts.values()].find(x=>x.login===email);if(!a||!a.active||!await matches(a.id,password))return accountError('邮箱或密码不正确，或账号已停用');actor=a.id;S.role=a.role;S.page=menus[a.role][0];closeModal();render()};
  window.accountForgot=function(){openModal('忘记密码','<p>企业成员请联系本企业管理员；分销或终端企业管理员请联系直属上级重置密码。</p><p>平台管理员请联系指定运维人员，核验身份后通过后台维护工具恢复，操作留痕，下次登录必须修改密码。</p><p class="hint">本页不提供短信或邮件找回。</p>')};
  function passwordForm(force){return '<form onsubmit="event.preventDefault();accountSavePassword('+force+')">'+(!force?'<label>当前密码<input id="currentPassword" type="password" required autocomplete="current-password"></label>':'')+'<div class="grid"><label>新密码<input id="accountNewPassword" type="password" required autocomplete="new-password"></label><label>确认新密码<input id="accountConfirmPassword" type="password" required autocomplete="new-password"></label></div><p class="hint">'+(force?'完成修改后才能进入工作空间。':'修改成功后需要使用新密码重新登录。')+'</p><p id="'+(force?'accountError':'accountModalError')+'" class="error" role="alert"></p><div class="actions"><button class="primary">'+(force?'设置密码并继续':'修改密码')+'</button></div></form>'}
  function forceView(){accountShell('首次登录 · 修改密码','<p>登录邮箱：'+esc(own().login)+'</p><p>当前使用临时密码，请先设置自己的密码。</p>'+passwordForm(true))}
  window.accountSettings=function(){if(!own())return render();if(own().mustChange)return forceView();openModal('账号设置 · 修改密码','<p>登录邮箱：'+esc(own().login)+'</p>'+passwordForm(false))};
  window.accountSavePassword=async function(force){await ready;const a=own();if(!a||force!==a.mustChange)return;const next=$('accountNewPassword').value,confirm=$('accountConfirmPassword').value;if(!next||next!==confirm)return accountError('请填写新密码，并确保两次输入一致');if(!force&&!await matches(a.id,$('currentPassword').value))return accountError('当前密码不正确');await setSecret(a.id,next);a.mustChange=false;log('本人改密',a);closeModal();if(!force)actor=null;render();toast(force?'密码已设置':'密码已修改，请重新登录')};
  function duplicate(email){return [...accounts.values()].some(a=>a.login===email)}
  function validEmail(email){return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)}
  function showHandoff(a,password,title){
    openModal(title,'<div class="notice">请复制账号信息交付给用户。关闭后不再显示此密码；遗失时请重新生成。</div><label>登录邮箱<input id="handoffEmail" readonly value="'+esc(a.login)+'"></label><label>临时密码<input id="handoffPassword" readonly value="'+esc(password)+'"></label><p>首次登录必须修改密码。</p><p id="copyStatus" role="status" aria-live="polite"></p><div class="actions"><button class="primary" onclick="accountCopy()">一键复制账号信息</button><button onclick="accountTryLogin()">演示此账号登录</button></div>');
    handoff={userId:a.id,email:a.login,password};
  }
  window.accountCopy=async function(){if(!handoff)return;const text='登录邮箱：'+handoff.email+'\n临时密码：'+handoff.password;try{await navigator.clipboard.writeText(text);if($('copyStatus'))$('copyStatus').textContent='账号信息已复制，请交付给用户。'}catch{if($('copyStatus'))$('copyStatus').textContent='复制失败，请重试，或手动复制上方邮箱和临时密码。'}};
  window.accountTryLogin=function(){if(!handoff)return;const email=handoff.email;accountLogout();$('loginEmail').value=email;$('loginPassword').focus()};
  childrenView=function(){if(!allowed()||!['platform','distributor'].includes(S.role))return render();$('view').innerHTML=head('下级管理','直属开户与管理员凭据交付。最多两级分销，上级不可迁移。')+'<section class="panel"><button class="primary" onclick="childModal()">开户（直属下级）</button><h2 style="margin-top:20px">直属下级</h2>'+[...orgs.values()].filter(o=>o.parent===own().org).map(o=>'<div class="item row between"><div><b>'+esc(o.name)+'</b><div class="hint">'+(o.kind==='terminal'?'终端企业':'分销组织')+' · '+esc(o.phone||'已有演示组织')+'</div></div><button onclick="accountChildDetail(\''+o.id+'\')">下级详情</button></div>').join('')+'</section><section class="panel"><h2>演示终端企业 · 交易定价</h2><p>组织启用 · 余额 '+amount(S.supplier.buyerBalance)+' · 直属上级：当前组织</p><label>每点售价（模拟）<input id="salePrice" type="number" value="0.20" step="0.01"></label><p class="hint">模拟平均进价0.15，m=10%，最低售价0.165；均为测试值，不是实际商务配置。</p><button onclick="savePrice()">保存售价</button></section>'};
  childModal=function(){if(!allowed()||!['platform','distributor'].includes(S.role))return;openModal('直属开户','<form onsubmit="event.preventDefault();accountCreateChild()"><div class="grid"><label>组织名称<input id="childName" required></label><label>组织类型<select id="childKind"><option value="terminal">终端企业</option>'+(S.role==='platform'?'<option value="distributor">一级分销</option>':'')+'</select></label><label>电话号码<input id="childPhone" type="tel" required autocomplete="tel"></label><label>管理员邮箱（登录账号）<input id="childEmail" type="email" required autocomplete="off"></label></div><p class="hint">邮箱全平台唯一；系统生成临时密码，成功后可一键复制。开户即固定直属上级。</p><p id="accountError" class="error" role="alert"></p><div class="actions"><button class="primary">确认开户</button></div></form>')};
  let creating=false;
  window.accountCreateChild=async function(){await ready;if(creating||!allowed()||!['platform','distributor'].includes(S.role))return;const name=$('childName').value.trim(),phone=$('childPhone').value,email=$('childEmail').value,kind=$('childKind').value;if(!name||!phone.trim()||!validEmail(email))return accountError('请填写组织名称、电话号码和有效邮箱');if(duplicate(email))return accountError('邮箱已占用，请使用其他登录邮箱');if(!['terminal',...(S.role==='platform'?['distributor']:[])].includes(kind))return accountError('不允许创建此层级');creating=true;try{const orgId='opened-org-'+(++serial),id='opened-admin-'+serial,password=randomPassword();await setSecret(id,password);const a={id,org:orgId,login:email,name:name+'管理员',role:kind==='terminal'?'admin':'distributor',active:true,mustChange:true};orgs.set(orgId,{id:orgId,name,phone,parent:own().org,kind});accounts.set(id,a);S.newChild={name,kind};log('直属开户',a);closeModal();render();showHandoff(a,password,'开户成功')}finally{creating=false}};
  window.accountChildDetail=function(id){const o=orgs.get(id);if(!allowed()||!o||o.parent!==own().org)return toast('仅直属上级可操作');const a=[...accounts.values()].find(x=>x.org===id&&x.role!=='sales');openModal('下级详情 · '+o.name,'<p>电话号码：'+esc(o.phone||'已有演示组织未填写')+'</p><p>管理员登录邮箱：'+esc(a?.login||'')+'</p><p class="hint">密码不支持查看。重新生成后旧密码立即失效，下次登录必须修改。</p>'+(a?'<button onclick="accountReset(\''+a.id+'\')">重置管理员密码</button>':''))};
  membersView=function(){if(!allowed()||S.role!=='admin')return render();$('view').innerHTML=head('成员管理','创建成员后生成临时密码，一键复制交付，首次登录必须改密。停用保留档案和历史。')+'<section class="panel"><button class="primary" onclick="memberModal()">创建成员</button><div class="tablewrap"><table><thead><tr><th>成员</th><th>登录邮箱</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>'+S.members.map(m=>'<tr><td>'+esc(m.name)+'</td><td>'+esc(m.login)+'</td><td>'+esc(m.role)+'</td><td>'+(m.active?'启用':'停用')+'</td><td><button onclick="resetMember('+m.id+')">重置密码</button> <button onclick="toggleMember('+m.id+')">'+(m.active?'停用':'恢复')+'</button></td></tr>').join('')+'</tbody></table></div></section>'};
  memberModal=function(){if(!allowed()||S.role!=='admin')return;openModal('直接创建成员','<form onsubmit="event.preventDefault();createMember()"><div class="grid"><label>姓名<input id="memberName" required></label><label>登录邮箱<input id="memberLogin" type="email" required></label><label>角色<select id="memberRole"><option>业务员</option><option>终端企业管理员</option></select></label></div><p class="hint">系统生成临时密码，无需手动设置；不发送邀请邮件。</p><p id="accountError" class="error" role="alert"></p><div class="actions"><button class="primary">创建本企业成员</button></div></form>')};
  createMember=async function(){await ready;if(creating||!allowed()||S.role!=='admin')return;const name=$('memberName').value.trim(),email=$('memberLogin').value,role=$('memberRole').value;if(!name||!validEmail(email))return accountError('请填写姓名和有效登录邮箱');if(duplicate(email))return accountError('邮箱已占用');if(!['业务员','终端企业管理员'].includes(role))return;creating=true;try{const id='created-member-'+(++serial),password=randomPassword();await setSecret(id,password);const a={id,org:own().org,name,login:email,role:role==='业务员'?'sales':'admin',active:true,mustChange:true};accounts.set(id,a);S.members.push({id:++S.memberSerial,accountId:id,name,login:email,role,active:true});log('创建成员',a);closeModal();render();showHandoff(a,password,'成员创建成功')}finally{creating=false}};
  const memberAccount=m=>accounts.get(m.id===1?seedIds.sales:m.accountId);
  resetMember=function(id){if(!allowed()||S.role!=='admin')return;const m=S.members.find(x=>x.id===id),a=m&&memberAccount(m);if(a)confirmReset(a)};
  function canReset(a){const me=own();if(!me||!allowed()||me.id===a.id)return false;return me.role==='admin'&&me.org===a.org||['platform','distributor'].includes(me.role)&&orgs.get(a.org)?.parent===me.org&&['admin','distributor'].includes(a.role)}
  function confirmReset(a){if(!canReset(a))return toast('无权重置此账号');openModal('重新生成临时密码','<p>目标邮箱：'+esc(a.login)+'</p><p>生成后旧密码立即失效，下次登录必须修改密码。账号停用状态保持不变。</p><div class="actions"><button class="primary" onclick="accountPerformReset(\''+a.id+'\')">确认生成临时密码</button></div>')}
  window.accountReset=id=>{const a=accounts.get(id);if(a)confirmReset(a)};
  window.accountPerformReset=async function(id){await ready;const a=accounts.get(id);if(!a||!canReset(a))return toast('无权重置此账号');const password=randomPassword();await setSecret(id,password);a.mustChange=true;log('管理方重置密码',a);closeModal();showHandoff(a,password,'临时密码已重新生成')};
  savePassword=function(){toast('请使用系统生成临时密码的流程')};
  const oldToggle=toggleMember;
  toggleMember=function(id){if(!allowed()||S.role!=='admin')return;const m=S.members.find(x=>x.id===id);if(!m)return;oldToggle(id);const a=memberAccount(m);if(a)a.active=m.active};
  // Block business entry points while logged out, forced to change password, or in a new organization.
  for(const name of ['searchCompanies','nextCandidates','identify','confirmIdentity','requestQuery','settleQuery','selectArchive','archiveView','contactsView','composeMail','sendBatch','settingsView','pointsView','ordersView','profitsView','platformView','businessView','savePrice','createOrder','confirmReceipt','transfer','confirmRefund']){
    const original=window[name];if(typeof original==='function')window[name]=function(...args){if(!allowed())return render();return original.apply(this,args)};
  }
  // Metadata only: no password or hash is exposed through the existing state inspector.
  window.accountPrototype={snapshot:()=>({actor,accounts:[...accounts.values()].map(a=>({...a})),organizations:[...orgs.values()].map(o=>({...o})),audit:[...audit]})};
  const style=document.createElement('style');style.textContent='.account-card{max-width:620px;margin:28px auto}.account-card label+label{margin-top:16px}#accountTools{gap:6px}#handoffEmail,#handoffPassword{font-family:Consolas,monospace}#accountTools button{white-space:nowrap}.topbar{flex-wrap:wrap}';document.head.append(style);
  ready.then(()=>render());
})();
