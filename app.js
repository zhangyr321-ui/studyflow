(() => {
  'use strict';
  const KEY = 'studyflow-mobile-v1';
  const DRAFT_KEY = 'studyflow-form-draft-v1';
  const OWNER_KEY = 'studyflow-cloud-owner-v1';
  const LOCAL_UPDATED_KEY = 'studyflow-local-updated-at-v1';
  const LOCAL_BACKUP_PREFIX = 'studyflow-local-backup-user-';
  const UNLINKED_BACKUP_KEY = 'studyflow-unlinked-local-backup-v1';
  const CLOUD_TABLE = 'studyflow_user_data';
  let supabaseClient = null, currentUser = null, cloudReady = false, cloudDirty = false;
  let cloudSyncBusy = false, cloudSyncTimer = null, cloudPollTimer = null, lastCloudUpdatedAt = 0;
  let localRevision = 0, activatingUserId = '', authMode = window.location.hash.includes('type=recovery') ? 'recovery' : 'login';

  const COLORS = ['#958fbe','#83a9b5','#8caf9b','#d19b8d','#c5a56c','#8399bf','#b48fa4','#79a8a2'];
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const uid = p => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
  const pad = n => String(n).padStart(2,'0');
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const today = () => dateKey(new Date());
  const parseDate = s => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d,12); };
  const addDays = (s,n) => { const d=parseDate(s); d.setDate(d.getDate()+n); return dateKey(d); };
  const daysBetween = (a,b) => Math.round((parseDate(b)-parseDate(a))/86400000);
  const esc = v => String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const fmtDate = s => { const d=parseDate(s); return `${d.getMonth()+1}月${d.getDate()}日`; };
  const fmtFullDate = s => { const d=parseDate(s); return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`; };
  const fmtTime = ms => { const d=new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtDuration = ms => { const min=Math.floor(ms/60000); if(min<60)return `${min}分钟`; const h=Math.floor(min/60),m=min%60; return m?`${h}小时${m}分`:`${h}小时`; };
  const clock = ms => { const s=Math.floor(ms/1000); return `${pad(Math.floor(s/3600))}:${pad(Math.floor(s%3600/60))}:${pad(s%60)}`; };
  const emptyState = (title,desc,action='',label='') => `<div class="empty"><b>${title}</b><p>${desc}</p>${action?`<button class="secondary small" data-action="${action}">${label}</button>`:''}</div>`;
  const defaultEventTypes=()=>[
    {id:'event_wake',name:'起床',active:true},{id:'event_breakfast',name:'早餐',active:true},{id:'event_lunch',name:'午餐',active:true},{id:'event_dinner',name:'晚餐',active:true},{id:'event_sleep',name:'睡觉',active:true}
  ];
  const defaultQuestions=()=>[
    {id:'question_best',text:'今天做得最好的一件事是什么？',type:'text',choices:[],schedule:'daily',weekdays:[],active:true},
    {id:'question_plan',text:'今天有没有按照计划生活？',type:'choice',choices:['是','一般','没有'],schedule:'daily',weekdays:[],active:true},
    {id:'question_adjust',text:'明天准备调整什么？',type:'text',choices:[],schedule:'daily',weekdays:[],active:true}
  ];
  const blank = () => ({version:4,countdowns:[],subjects:[],projects:[],tasks:[],taskStates:{},records:[],reviews:[],mockSeries:[],mockRecords:[],journal:{days:{},events:[],notes:[],eventTypes:defaultEventTypes(),questions:defaultQuestions(),answers:[]},timer:{status:'idle',taskId:'',taskDate:'',segments:[],currentStart:null}});
  let state = load();
  let view='home', taskMain='tasks', taskState='today', projectState='active', subjectFilter='', mockSeriesFilter='';
  let recordDate=today(), statsMode='day', statsAnchor=today(), reviewSubject='', reviewTag='', reviewMonth='', reviewView='recent', reviewArchiveMode='subject', reviewSearch='', reviewLimit=20, journalView='today', journalDate=today(), formCtx=null, pendingReturn=null, pendingSubjectReturn=null, confirmCallback=null, tick=null;

  function load(){
    try{
      const raw=localStorage.getItem(KEY);if(!raw)return blank();const x=JSON.parse(raw),b=blank();if(!x||typeof x!=='object')throw Error();
      ['countdowns','subjects','projects','tasks','records','reviews','mockSeries','mockRecords'].forEach(k=>b[k]=Array.isArray(x[k])?x[k]:[]);
      b.taskStates=x.taskStates&&typeof x.taskStates==='object'?x.taskStates:{};
      if(x.journal&&typeof x.journal==='object'){const savedQuestions=Array.isArray(x.journal.questions)?x.journal.questions:null;b.journal={...b.journal,...x.journal,days:x.journal.days&&typeof x.journal.days==='object'?x.journal.days:{},events:Array.isArray(x.journal.events)?x.journal.events:[],notes:Array.isArray(x.journal.notes)?x.journal.notes:[],eventTypes:Array.isArray(x.journal.eventTypes)&&x.journal.eventTypes.length?x.journal.eventTypes:defaultEventTypes(),questions:savedQuestions&&savedQuestions.length?savedQuestions:defaultQuestions(),answers:Array.isArray(x.journal.answers)?x.journal.answers:[]};}
      b.timer=x.timer&&['idle','running','paused'].includes(x.timer.status)?{...b.timer,...x.timer}:b.timer;
      b.records.forEach(r=>{const t=b.tasks.find(x=>x.id===r.taskId),s=b.subjects.find(x=>x.id===r.subjectId);r.taskTitle=r.taskTitle||t?.title||'';r.subjectName=r.subjectName||s?.name||'';r.subjectColor=r.subjectColor||s?.color||'#aaa';});
      b.version=4;return b;
    }catch(e){setTimeout(()=>toast('本地数据读取失败，已恢复空白状态。','error'),50);return blank();}
  }
  function save(){
    try{
      localStorage.setItem(KEY,JSON.stringify(state));
      localStorage.setItem(LOCAL_UPDATED_KEY,String(Date.now()));
      localRevision += 1;
      if(currentUser && cloudReady){
        cloudDirty = true;
        queueCloudSave();
      }
    }catch(e){toast('保存失败，请检查浏览器存储空间。','error');}
  }

  function normalizeState(input){
    const b=blank();
    if(!input || typeof input!=='object' || Array.isArray(input)) return b;
    ['countdowns','subjects','projects','tasks','records','reviews','mockSeries','mockRecords'].forEach(k=>b[k]=Array.isArray(input[k])?input[k]:[]);
    b.taskStates=input.taskStates&&typeof input.taskStates==='object'?input.taskStates:{};
    if(input.journal&&typeof input.journal==='object'){
      const j=input.journal;
      b.journal={...b.journal,...j,
        days:j.days&&typeof j.days==='object'?j.days:{},
        events:Array.isArray(j.events)?j.events:[],
        notes:Array.isArray(j.notes)?j.notes:[],
        eventTypes:Array.isArray(j.eventTypes)&&j.eventTypes.length?j.eventTypes:defaultEventTypes(),
        questions:Array.isArray(j.questions)&&j.questions.length?j.questions:defaultQuestions(),
        answers:Array.isArray(j.answers)?j.answers:[]};
    }
    b.timer=input.timer&&['idle','running','paused'].includes(input.timer.status)?{...b.timer,...input.timer}:b.timer;
    b.records=b.records.map(r=>{
      const t=b.tasks.find(x=>x.id===r.taskId), s=b.subjects.find(x=>x.id===r.subjectId);
      return {...r,taskTitle:r.taskTitle||t?.title||'',subjectName:r.subjectName||s?.name||'',subjectColor:r.subjectColor||s?.color||'#aaa'};
    });
    b.version=4;
    return b;
  }

  function hasMeaningfulData(x){
    if(!x || typeof x!=='object') return false;
    const arrays=['countdowns','subjects','projects','tasks','records','reviews','mockSeries','mockRecords'];
    if(arrays.some(k=>Array.isArray(x[k])&&x[k].length)) return true;
    const j=x.journal||{};
    return Object.keys(x.taskStates||{}).length>0 ||
      Object.keys(j.days||{}).length>0 ||
      ['events','notes','answers'].some(k=>Array.isArray(j[k])&&j[k].length>0) ||
      !!(x.timer&&x.timer.status&&x.timer.status!=='idle');
  }

  function mergeById(localItems, cloudItems){
    const merged=new Map();
    (Array.isArray(localItems)?localItems:[]).forEach((item,i)=>{
      const key=item&&item.id?String(item.id):'local-'+i;
      merged.set(key,{...(merged.get(key)||{}),...item});
    });
    (Array.isArray(cloudItems)?cloudItems:[]).forEach((item,i)=>{
      const key=item&&item.id?String(item.id):'cloud-'+i;
      merged.set(key,{...(merged.get(key)||{}),...item});
    });
    return Array.from(merged.values());
  }

  function mergeStates(localInput, cloudInput){
    const l=normalizeState(localInput), c=normalizeState(cloudInput);
    const out={...l,...c};
    ['countdowns','subjects','projects','tasks','records','reviews','mockSeries','mockRecords'].forEach(k=>out[k]=mergeById(l[k],c[k]));
    out.taskStates={...l.taskStates,...c.taskStates};
    const days={...l.journal.days};
    Object.keys(c.journal.days||{}).forEach(day=>{days[day]={...(days[day]||{}),...(c.journal.days[day]||{})};});
    out.journal={...l.journal,...c.journal,days,
      events:mergeById(l.journal.events,c.journal.events),
      notes:mergeById(l.journal.notes,c.journal.notes),
      eventTypes:mergeById(l.journal.eventTypes,c.journal.eventTypes),
      questions:mergeById(l.journal.questions,c.journal.questions),
      answers:mergeById(l.journal.answers,c.journal.answers)};
    out.timer=l.timer&&l.timer.status!=='idle'?l.timer:c.timer;
    return normalizeState(out);
  }

  function persistLocalOnly(updatedAt){
    try{
      localStorage.setItem(KEY,JSON.stringify(state));
      localStorage.setItem(LOCAL_UPDATED_KEY,String(updatedAt||Date.now()));
    }catch(e){toast('本机数据保存失败，请导出备份。','error');}
  }

  function setSyncStatus(message,isError){
    const header=$('#syncStatusHeader');
    if(header){header.textContent=message;header.classList.toggle('error',!!isError);}
    const detail=$('#syncStatusDetail');
    if(detail) detail.textContent=message;
  }

  function setAuthGateVisible(visible){$('#authGate')?.classList.toggle('hidden',!visible);}
  function setAuthMessage(message,type){
    const el=$('#authMessage');
    if(!el)return;
    el.textContent=message||'';
    el.className='auth-message'+(type?' '+type:'');
  }

  function setAuthMode(mode){
    authMode=mode;
    const tabs=$('#authTabs');
    if(tabs)tabs.classList.toggle('hidden',mode==='recovery');
    $('[data-auth-mode]').forEach(b=>b.classList.toggle('active',b.dataset.authMode===mode));
    const label=$('#authPasswordLabel'), input=$('#authPassword'), submit=$('#authSubmit');
    if(label)label.textContent=mode==='recovery'?'新密码':'密码';
    if(input){input.autocomplete=mode==='recovery'?'new-password':mode==='signup'?'new-password':'current-password';input.value='';}
    if(submit)submit.textContent=mode==='signup'?'创建账号':mode==='recovery'?'更新密码':'登录';
    $('#resetPasswordBtn')?.classList.toggle('hidden',mode==='recovery');
    setAuthMessage('', '');
  }

  function authErrorMessage(error){
    const message=String(error&&error.message||error||'未知错误');
    if(/invalid login credentials/i.test(message))return '邮箱或密码不正确，请检查后重试。';
    if(/email not confirmed/i.test(message))return '邮箱尚未验证，请先打开验证邮件中的链接。';
    if(/already registered|user already registered/i.test(message))return '这个邮箱已经注册，请切换到登录。';
    if(/password.*(least|short|characters)/i.test(message))return '密码长度不符合要求，请至少使用 8 位密码。';
    if(/row-level security|permission denied|policy/i.test(message))return '云端数据权限检查失败，请确认已执行 schema.sql。';
    return message;
  }

  function queueCloudSave(){
    if(!currentUser||!cloudReady)return;
    clearTimeout(cloudSyncTimer);
    setSyncStatus('有修改待同步',false);
    cloudSyncTimer=setTimeout(()=>{pushCloudState();},900);
  }

  async function pushCloudState(){
    if(!currentUser||!cloudReady||!supabaseClient)return false;
    if(cloudSyncBusy){queueCloudSave();return false;}
    if(!cloudDirty)return true;
    clearTimeout(cloudSyncTimer);cloudSyncTimer=null;
    cloudSyncBusy=true;
    const revision=localRevision;
    const snapshot=JSON.parse(JSON.stringify(state));
    setSyncStatus('正在同步…',false);
    let succeeded=false;
    try{
      const result=await supabaseClient.from(CLOUD_TABLE)
        .upsert({user_id:currentUser.id,data:snapshot},{onConflict:'user_id'})
        .select('updated_at').single();
      if(result.error)throw result.error;
      lastCloudUpdatedAt=Date.parse(result.data&&result.data.updated_at)||Date.now();
      if(revision===localRevision){
        cloudDirty=false;
        localStorage.setItem(LOCAL_UPDATED_KEY,String(lastCloudUpdatedAt));
        setSyncStatus('云端已同步',false);
      }else{
        cloudDirty=true;
        setSyncStatus('有新修改，继续同步',false);
      }
      succeeded=true;
    }catch(error){
      cloudDirty=true;
      setSyncStatus('同步失败（本机已保存）',true);
      console.error('StudyFlow cloud sync failed:',error&&error.message||error);
    }finally{
      cloudSyncBusy=false;
      if(succeeded&&cloudDirty)queueCloudSave();
    }
    return succeeded;
  }

  async function syncFromCloud(){
    if(!currentUser||!cloudReady||!supabaseClient||cloudDirty||cloudSyncBusy)return;
    try{
      const result=await supabaseClient.from(CLOUD_TABLE).select('data,updated_at').eq('user_id',currentUser.id).maybeSingle();
      if(result.error)throw result.error;
      if(!result.data)return;
      const serverTime=Date.parse(result.data.updated_at)||0;
      if(serverTime>lastCloudUpdatedAt+500){
        state=normalizeState(result.data.data);
        lastCloudUpdatedAt=serverTime;
        localStorage.setItem(OWNER_KEY,currentUser.id);
        persistLocalOnly(serverTime);
        render();
        setSyncStatus('已从云端更新',false);
      }
    }catch(error){
      setSyncStatus('暂时无法读取云端',true);
      console.error('StudyFlow cloud refresh failed:',error&&error.message||error);
    }
  }

  function exportUnlinkedBackup(){
    try{
      const raw=localStorage.getItem(UNLINKED_BACKUP_KEY);
      if(!raw)return toast('没有可导出的本机备份。','error');
      const blob=new Blob([raw],{type:'application/json'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='StudyFlow-local-backup.json';a.click();
      URL.revokeObjectURL(a.href);
      toast('本机备份已导出。');
    }catch(e){toast('备份导出失败。','error');}
  }

  function backupLocalForOwner(owner,localState,updatedAt){
    if(!owner||!hasMeaningfulData(localState))return;
    try{localStorage.setItem(LOCAL_BACKUP_PREFIX+owner,JSON.stringify({state:localState,updatedAt:updatedAt||Date.now()}));}
    catch(e){toast('旧账号本机备份失败，请先导出数据。','error');}
  }

  async function activateUser(user){
    if(!user)return;
    if(currentUser&&currentUser.id===user.id&&cloudReady){setAuthGateVisible(false);return;}
    if(activatingUserId===user.id)return;
    activatingUserId=user.id;
    currentUser=user;
    cloudReady=false;
    cloudDirty=false;
    setAuthGateVisible(true);
    setAuthMessage('正在读取你的学习数据…','');
    setSyncStatus('正在连接云端',false);
    try{
      const localNow=normalizeState(load());
      const owner=localStorage.getItem(OWNER_KEY);
      const localUpdated=Number(localStorage.getItem(LOCAL_UPDATED_KEY)||0);
      let candidate=null, candidateKind='none', candidateUpdated=0;
      if(owner===user.id){
        candidate=localNow;candidateKind='owned';candidateUpdated=localUpdated;
      }else if(!owner&&hasMeaningfulData(localNow)){
        candidate=localNow;candidateKind='unlinked';candidateUpdated=localUpdated;
      }else{
        try{
          const rawBackup=localStorage.getItem(LOCAL_BACKUP_PREFIX+user.id);
          if(rawBackup){
            const backup=JSON.parse(rawBackup);
            if(backup&&backup.state){candidate=normalizeState(backup.state);candidateKind='backup';candidateUpdated=Number(backup.updatedAt||0);}
          }
        }catch(e){}
      }
      if(owner&&owner!==user.id)backupLocalForOwner(owner,localNow,localUpdated);

      const result=await supabaseClient.from(CLOUD_TABLE).select('data,updated_at').eq('user_id',user.id).maybeSingle();
      if(result.error)throw result.error;

      if(result.data){
        const remote=normalizeState(result.data.data);
        lastCloudUpdatedAt=Date.parse(result.data.updated_at)||Date.now();
        let chosen=remote;
        if(candidate&&hasMeaningfulData(candidate)){
          if(candidateKind==='owned'){
            chosen=mergeStates(candidate,remote);
          }else{
            const merge=window.confirm('检测到本机也有学习数据。确定：将本机与云端数据合并（同一条记录冲突时以云端为准）；取消：使用云端数据，并保留本机数据备份。');
            if(merge)chosen=mergeStates(candidate,remote);
            else if(candidateKind==='unlinked'){
              localStorage.setItem(UNLINKED_BACKUP_KEY,JSON.stringify({state:candidate,createdAt:new Date().toISOString()}));
            }
          }
        }
        state=normalizeState(chosen);
        localStorage.setItem(OWNER_KEY,user.id);
        persistLocalOnly(lastCloudUpdatedAt);
        cloudReady=true;
        render();
        setAuthGateVisible(false);
        const changed=JSON.stringify(state)!==JSON.stringify(remote);
        if(changed){
          cloudDirty=true;localRevision+=1;
          await pushCloudState();
        }else setSyncStatus('云端已同步',false);
      }else{
        if(candidate&&hasMeaningfulData(candidate)&&candidateKind!=='owned'){
          const migrate=window.confirm('检测到本机已有学习数据。是否将这些数据迁移到当前账号的云端？确定：迁移并同步；取消：保持本机数据不变，并取消本次登录。');
          if(!migrate){
            setAuthMessage('已取消迁移，本机数据未更改。再次登录时可以重新选择。','');
            await supabaseClient.auth.signOut();
            return;
          }
        }
        state=candidate&&hasMeaningfulData(candidate)?normalizeState(candidate):blank();
        localStorage.setItem(OWNER_KEY,user.id);
        persistLocalOnly(Date.now());
        cloudReady=true;
        cloudDirty=true;localRevision+=1;
        render();
        setAuthGateVisible(false);
        await pushCloudState();
        if(!cloudDirty)setSyncStatus('云端已同步',false);
      }
      if(!cloudPollTimer)cloudPollTimer=setInterval(()=>{syncFromCloud();},30000);
    }catch(error){
      cloudReady=false;
      setSyncStatus('云端连接失败',true);
      setAuthMessage('账号已登录，但读取云端数据失败：'+authErrorMessage(error)+'。请确认表和权限已配置，再刷新重试。','error');
      console.error('StudyFlow cloud initialization failed:',error&&error.message||error);
    }finally{
      activatingUserId='';
    }
  }

  function deactivateUser(){
    currentUser=null;cloudReady=false;cloudDirty=false;
    clearTimeout(cloudSyncTimer);cloudSyncTimer=null;
    setAuthGateVisible(true);
    setSyncStatus('未登录',false);
    setAuthMessage('已退出登录。','');
  }

  async function signOutUser(){
    if(!supabaseClient||!currentUser)return;
    if(cloudDirty){
      clearTimeout(cloudSyncTimer);
      const ok=await pushCloudState();
      if(!ok){
        const proceed=window.confirm('部分数据尚未同步成功，但本机仍保留数据。仍要退出登录吗？');
        if(!proceed)return;
      }
    }
    const result=await supabaseClient.auth.signOut();
    if(result.error)toast('退出登录失败：'+authErrorMessage(result.error),'error');
    else $('#detailDialog').close();
  }

  async function initAuth(){
    const url=window.STUDYFLOW_SUPABASE_URL;
    const key=window.STUDYFLOW_SUPABASE_ANON_KEY;
    if(!window.supabase||typeof window.supabase.createClient!=='function'){
      $('#authConfigWarning').classList.remove('hidden');
      setAuthMessage('Supabase 客户端加载失败，请检查网络后刷新。','error');
      $('#authSubmit').disabled=true;
      setSyncStatus('客户端未加载',true);
      return;
    }
    if(!url||!key||/PASTE_|YOUR_SUPABASE|REPLACE_ME/i.test(key)){
      $('#authConfigWarning').classList.remove('hidden');
      setAuthMessage('完成 supabase-config.js 配置后即可注册或登录。','');
      $('#authSubmit').disabled=true;
      $('#resetPasswordBtn').disabled=true;
      setSyncStatus('待配置',true);
      return;
    }
    supabaseClient=window.supabase.createClient(url,key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    supabaseClient.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT'){deactivateUser();return;}
      if(event==='PASSWORD_RECOVERY'||window.location.hash.includes('type=recovery')){
        setAuthMode('recovery');setAuthGateVisible(true);setAuthMessage('请设置一个新的登录密码。','');return;
      }
      if(event==='INITIAL_SESSION'&&!session){
        setAuthGateVisible(true);setSyncStatus('未登录',false);
        if(authMode!=='recovery')setAuthMode('login');
        return;
      }
      if((event==='INITIAL_SESSION'||event==='SIGNED_IN')&&session&&session.user){
        setTimeout(()=>activateUser(session.user),0);
      }
    });
    setAuthMode(authMode);
    if(authMode==='recovery')setAuthMessage('请设置一个新的登录密码。','');
    $('#authForm').querySelectorAll('input').forEach(input=>input.disabled=false);
    $('#authSubmit').disabled=false;
    $('#resetPasswordBtn').disabled=false;
  }

  $('#authForm').addEventListener('submit',async e=>{
    e.preventDefault();
    if(!supabaseClient)return setAuthMessage('请先完成 Supabase 配置。','error');
    const email=$('#authEmail').value.trim();
    const password=$('#authPassword').value;
    const button=$('#authSubmit');
    button.disabled=true;
    setAuthMessage(authMode==='signup'?'正在创建账号…':authMode==='recovery'?'正在更新密码…':'正在登录…','');
    try{
      if(authMode==='login'){
        const result=await supabaseClient.auth.signInWithPassword({email,password});
        if(result.error)throw result.error;
        setAuthMessage('登录成功，正在读取你的数据…','success');
      }else if(authMode==='signup'){
        const result=await supabaseClient.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin+window.location.pathname}});
        if(result.error)throw result.error;
        if(result.data&&result.data.session)setAuthMessage('注册成功，正在进入 StudyFlow…','success');
        else setAuthMessage('注册成功！请打开邮箱中的验证链接，再回到此页面登录。','success');
      }else{
        const result=await supabaseClient.auth.updateUser({password});
        if(result.error)throw result.error;
        await supabaseClient.auth.signOut();
        history.replaceState(null,document.title,window.location.pathname+window.location.search);
        setAuthMode('login');
        setAuthMessage('密码已更新，请使用新密码登录。','success');
      }
    }catch(error){setAuthMessage(authErrorMessage(error),'error');}
    finally{button.disabled=false;}
  });

  $('#resetPasswordBtn').addEventListener('click',async()=>{
    if(!supabaseClient)return setAuthMessage('请先完成 Supabase 配置。','error');
    const email=$('#authEmail').value.trim();
    if(!email)return setAuthMessage('请先填写邮箱，再点击忘记密码。','error');
    $('#resetPasswordBtn').disabled=true;
    try{
      const result=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname});
      if(result.error)throw result.error;
      setAuthMessage('如果该邮箱已注册，请查看收件箱中的密码重置邮件。','success');
    }catch(error){setAuthMessage(authErrorMessage(error),'error');}
    finally{$('#resetPasswordBtn').disabled=false;}
  });

  const subject = id => state.subjects.find(x=>x.id===id);
  const task = id => state.tasks.find(x=>x.id===id);
  const project = id => state.projects.find(x=>x.id===id);
  const recordTitle = r => task(r.taskId)?.title||r.taskTitle||'临时学习';
  const recordSubject = r => subject(r.subjectId)||{name:r.subjectName||'未知科目',color:r.subjectColor||'#aaa'};
  const taskStateKey = (id,date) => `${id}|${date}`;
  const stateOf = (id,date) => state.taskStates[taskStateKey(id,date)]||{completed:false};
  function scheduled(t,date){if(date<t.startDate||t.endDate&&date>t.endDate)return false;const day=parseDate(date).getDay();if(t.repeat==='none')return date===t.startDate;if(t.repeat==='daily')return true;if(t.repeat==='weekdays')return day>=1&&day<=5;if(t.repeat==='weekly')return (t.weekdays||[]).includes(day);return false;}
  function occurrences(start,end){const out=[];state.tasks.forEach(t=>{let d=start;while(d<=end){if(scheduled(t,d))out.push({...t,instanceDate:d,...stateOf(t.id,d)});d=addDays(d,1);}});return out;}
  function earliestTaskDate(){return state.tasks.reduce((m,t)=>!m||t.startDate<m?t.startDate:m,'')||today();}
  function recordsIn(start,end){return state.records.filter(r=>r.date>=start&&r.date<=end);}
  function recordDuration(r){return (r.segments||[]).reduce((n,s)=>n+Math.max(0,s.end-s.start),0);}
  function periodStats(start,end){const rs=recordsIn(start,end),os=occurrences(start,end),days=[];let d=start;while(d<=end){days.push(d);d=addDays(d,1);}const totalMs=rs.reduce((n,r)=>n+recordDuration(r),0),q=rs.reduce((n,r)=>n+(+r.questions||0),0),w=rs.reduce((n,r)=>n+(+r.wrong||0),0);return{records:rs,tasks:os,totalMs,studyDays:new Set(rs.map(r=>r.date)).size,done:os.filter(o=>o.completed).length,totalTasks:os.length,completeDays:days.filter(x=>{const xs=os.filter(o=>o.instanceDate===x);return xs.length&&xs.every(o=>o.completed);}).length,questions:q,wrong:w,accuracy:q?Math.round((q-w)/q*1000)/10:null};}
  function projectTotals(id){const p=project(id),rs=state.records.filter(r=>r.projectId===id),units=(+p?.initialProgress||0)+rs.reduce((n,r)=>n+(+r.units||0),0),recordQ=rs.reduce((n,r)=>n+(+r.questions||0),0),recordCorrect=rs.reduce((n,r)=>n+Math.max(0,(+r.questions||0)-(+r.wrong||0)),0),initialQ=+p?.initialQuestions||0,initialCorrect=initialQ*(+p?.initialAccuracy||0)/100,q=initialQ+recordQ,correct=initialCorrect+recordCorrect;return{units,q,correct,w:q-correct,accuracy:q?Math.round(correct/q*1000)/10:null};}
  function subjectTotals(id){const rs=state.records.filter(r=>r.subjectId===id),ps=state.projects.filter(p=>p.subjectId===id),recordQ=rs.reduce((n,r)=>n+(+r.questions||0),0),recordCorrect=rs.reduce((n,r)=>n+Math.max(0,(+r.questions||0)-(+r.wrong||0)),0),initialQ=ps.reduce((n,p)=>n+(+p.initialQuestions||0),0),initialCorrect=ps.reduce((n,p)=>n+(+p.initialQuestions||0)*(+p.initialAccuracy||0)/100,0),q=recordQ+initialQ,correct=recordCorrect+initialCorrect;return{q,accuracy:q?Math.round(correct/q*1000)/10:null};}
  function projectEnded(p){return !!p.manualEnded||projectTotals(p.id).units>=+p.total;}
  function breakdown(start,end){const rs=recordsIn(start,end),map={};rs.forEach(r=>{map[r.subjectId]=(map[r.subjectId]||0)+recordDuration(r);});return Object.entries(map).map(([id,ms])=>({s:subject(id),ms})).filter(x=>x.s).sort((a,b)=>b.ms-a.ms);}
  function dayTaskStatus(date){const xs=occurrences(date,date);if(date>today())return 'future';if(!xs.length)return 'no-tasks';if(xs.every(x=>x.completed))return 'done';if(date===today())return 'in-progress';return 'missed';}
  function timerElapsed(){const t=state.timer;const done=(t.segments||[]).reduce((n,s)=>n+s.end-s.start,0);return done+(t.status==='running'&&t.currentStart?Date.now()-t.currentStart:0);}

  function render(){renderHeader();renderHome();renderTasks();renderReviews();renderJournal();renderStats();renderNav();updateTimer();}
  function renderHeader(){const d=new Date(),weeks=['周日','周一','周二','周三','周四','周五','周六'];$('#headerDate').textContent=`${d.getMonth()+1}月${d.getDate()}日 · ${weeks[d.getDay()]}`;$('#greeting').textContent=d.getHours()<11?'早上好':d.getHours()<18?'下午好':'晚上好';}
  function renderNav(){$$('.page').forEach(x=>x.classList.toggle('active',x.dataset.page===view));$$('[data-nav]').forEach(x=>x.classList.toggle('active',x.dataset.nav===view));}
  function go(v){view=v;renderNav();window.scrollTo({top:0,behavior:'smooth'});if(v==='tasks')renderTasks();if(v==='reviews')renderReviews();if(v==='journal')renderJournal();if(v==='stats')renderStats();}

  function renderHome(){
    const fresh=!state.subjects.length&&!state.tasks.length&&!state.records.length;$('#onboardingCard').classList.toggle('hidden',!fresh);if(fresh)$('#onboardingCard').innerHTML=`<div class="section-title"><h2>从这里开始</h2><span class="soft-chip">首次使用</span></div><ol><li>创建科目</li><li>创建学习项目</li><li>添加今天的任务</li><li>从任务开始学习</li></ol><button class="primary full" data-action="add-subject">创建第一个科目</button>`;
    const sorted=[...state.countdowns].sort((a,b)=>{const ae=a.date<today(),be=b.date<today();return ae!==be?ae-be:a.date.localeCompare(b.date);});
    $('#countdownList').innerHTML=sorted.length?sorted.map(c=>{const diff=daysBetween(today(),c.date),ended=diff<0,current=(c.stages||[]).filter(s=>s.start<=today()&&s.end>=today());return `<article class="countdown-card ${ended?'ended':''}"><div class="count-top"><h3>${esc(c.name)}</h3><span>${fmtFullDate(c.date)}</span></div><div class="count-days">${ended?'已结束':diff===0?'就是今天':diff}<span>${diff>0?' 天':''}</span></div>${c.note?`<p>${esc(c.note)}</p>`:''}<div class="stage-chips">${current.length?current.map(s=>`<span>${esc(s.name)}</span>`).join(''):'<span>暂无当前阶段</span>'}</div><div class="count-actions"><button data-edit-countdown="${c.id}">编辑</button><button data-manage-stages="${c.id}">阶段</button><button data-delete-countdown="${c.id}">删除</button></div></article>`}).join(''):`<div class="empty-inline">还没有重要日子<br><button class="text-btn" data-action="add-countdown">设置第一个倒计时</button></div>`;
    const ts=occurrences(today(),today());$('#homeTaskList').innerHTML=ts.length?ts.map(o=>taskRow(o,true)).join(''):emptyState('今天没有任务','去任务页安排今天要做的事。','add-task','添加任务');
    renderHomeRecords();
    const st=periodStats(today(),today());$('#todayCompletionChip').textContent=`${st.done}/${st.totalTasks} 完成`;$('#todayMetrics').innerHTML=`${metric('学习时长',fmtDuration(st.totalMs))}${metric('完成题量',`${st.questions}题`)}${metric('正确题数',`${Math.max(0,st.questions-st.wrong)}题`)}${metric('错题数',`${st.wrong}题`)}${metric('综合正确率',st.accuracy===null?'—':`${st.accuracy}%`)}${metric('任务完成',`${st.done}/${st.totalTasks}`)}`;
    $('#todaySubjectBars').innerHTML=bars(breakdown(today(),today()))||emptyState('还没有学习记录','从任务开始计时后，这里会显示科目构成。');
    const all=periodStats(earliestTaskDate(),today()),pct=all.totalTasks?Math.round(all.done/all.totalTasks*100):0;$('#overallPct').textContent=`${pct}%`;$('#overallBar').style.width=`${pct}%`;$('#overallText').textContent=all.totalTasks?`已完成 ${all.done} 项 · 应完成 ${all.totalTasks} 项 · 剩余 ${all.totalTasks-all.done} 项`:'暂无任务';
    const overdue=all.tasks.filter(o=>o.instanceDate<today()&&!o.completed);$('#overdueCard').classList.toggle('hidden',!overdue.length);if(overdue.length)$('#overdueCard').innerHTML=`<h3>还有 ${overdue.length} 个历史任务未完成</h3><p>可以继续补做，完成后原日期会重新计算。</p><button class="text-btn" data-action="show-overdue">去补做 →</button>`;
  }
  const metric=(name,value)=>`<div class="metric"><span>${name}</span><strong>${value}</strong></div>`;
  function renderHomeRecords(){const rs=state.records.filter(r=>r.date===today()).sort((a,b)=>(b.segments?.[0]?.start||0)-(a.segments?.[0]?.start||0)),shown=rs.slice(0,3),total=rs.reduce((n,r)=>n+recordDuration(r),0);$('#homeRecordList').innerHTML=shown.length?shown.map(r=>{const s=recordSubject(r),first=r.segments?.[0],last=r.segments?.[r.segments.length-1];return `<button class="home-record" data-record-detail="${r.id}"><time>${first?fmtTime(first.start):'—'}–${last?fmtTime(last.end):'—'}</time><span><b><i class="dot" style="background:${s.color}"></i> ${esc(recordTitle(r))}</b><small>${esc(s.name)}</small></span><strong>${fmtDuration(recordDuration(r))}</strong></button>`;}).join(''):emptyState('今天还没有学习记录','完成一次计时，或手动补录一段学习时间。','add-record','手动添加');$('#homeRecordFoot').classList.toggle('hidden',!rs.length);if(rs.length)$('#homeRecordFoot').innerHTML=`<span>今日共学习 ${fmtDuration(total)}${rs.length>3?` · 还有 ${rs.length-3} 条`:''}</span><button class="text-btn" data-action="show-today-stats">完整时间轴 →</button>`;}
  function bars(items){const max=Math.max(1,...items.map(x=>x.ms));return items.map(x=>`<div class="bar-row"><span><i class="dot" style="background:${x.s.color}"></i> ${esc(x.s.name)}</span><div class="bar-track"><i style="width:${x.ms/max*100}%;background:${x.s.color}"></i></div><b>${fmtDuration(x.ms)}</b></div>`).join('');}

  function taskRow(o,home=false){const s=subject(o.subjectId),past=o.instanceDate<today(),canEdit=!past;return `<article class="task-row ${o.completed?'done':''}"><button class="task-check" data-toggle-task="${o.id}" data-task-date="${o.instanceDate}">${o.completed?'✓':''}</button><div><span class="task-name">${esc(o.title)}</span><div class="task-meta"><span><i class="dot" style="background:${s?.color||'#aaa'}"></i> ${esc(s?.name||'未知科目')}</span>${!home?`<span>${fmtDate(o.instanceDate)}</span>`:''}${past&&!o.completed?'<span>待补做</span>':''}</div></div><div class="task-actions"><button class="round-start" data-start-timer="${o.id}" data-task-date="${o.instanceDate}" aria-label="开始计时">${state.timer.taskId===o.id&&state.timer.status!=='idle'?'▶':'◷'}</button>${!home&&canEdit?`<button class="more-btn" data-task-menu="${o.id}" data-task-date="${o.instanceDate}">⋮</button>`:''}</div></article>`;}
  function renderTasks(){
    $$('#taskMainTabs button').forEach(x=>x.classList.toggle('active',x.dataset.taskMain===taskMain));$('#taskPane').classList.toggle('hidden',taskMain!=='tasks');$('#projectPane').classList.toggle('hidden',taskMain!=='projects');$('#subjectPane').classList.toggle('hidden',taskMain!=='subjects');$('#mockPane').classList.toggle('hidden',taskMain!=='mocks');$('#taskPageAdd').textContent=taskMain==='tasks'?'＋ 任务':taskMain==='projects'?'＋ 项目':taskMain==='subjects'?'＋ 科目':'＋ 模考';
    if(taskMain==='tasks'){
      const subjects=`<button class="${!subjectFilter?'active':''}" data-subject-filter="">全部</button>`+state.subjects.map(s=>`<button class="${subjectFilter===s.id?'active':''}" data-subject-filter="${s.id}"><i class="dot" style="background:${s.color}"></i> ${esc(s.name)}</button>`).join('')+`<button data-action="manage-subjects">＋ 科目</button>`;$('#subjectFilters').innerHTML=subjects;
      $$('#taskStateTabs button').forEach(x=>x.classList.toggle('active',x.dataset.taskState===taskState));let os=[];if(taskState==='today')os=occurrences(today(),today());if(taskState==='overdue')os=occurrences(earliestTaskDate(),addDays(today(),-1)).filter(o=>!o.completed).sort((a,b)=>b.instanceDate.localeCompare(a.instanceDate));if(taskState==='completed')os=occurrences(earliestTaskDate(),today()).filter(o=>o.completed).sort((a,b)=>(b.completedAt||'').localeCompare(a.completedAt||''));if(subjectFilter)os=os.filter(o=>o.subjectId===subjectFilter);$('#taskList').innerHTML=os.length?os.slice(0,120).map(o=>taskRow(o)).join(''):emptyState('这里暂时没有任务',taskState==='overdue'?'过去的任务都处理好了。':'添加一个清晰的小任务开始。','add-task','添加任务');
    }else if(taskMain==='projects'){
      $$('#projectStateTabs button').forEach(x=>x.classList.toggle('active',x.dataset.projectState===projectState));const ps=state.projects.filter(p=>(projectEnded(p)?'ended':'active')===projectState);$('#projectList').innerHTML=ps.length?ps.map(projectCard).join(''):emptyState(projectState==='active'?'还没有进行中的项目':'还没有已结束项目','项目可以记录课程、题本或训练进度。','add-project','添加项目');
    }else if(taskMain==='subjects'){
      $('#subjectList').innerHTML=state.subjects.length?state.subjects.map(s=>{const ps=state.projects.filter(p=>p.subjectId===s.id),ts=state.tasks.filter(t=>t.subjectId===s.id),active=ps.filter(p=>!projectEnded(p)).length,totals=subjectTotals(s.id);return `<article class="subject-card" style="--subject-color:${s.color}"><div><i class="subject-swatch" style="background:${s.color}"></i><h3>${esc(s.name)}</h3><p>${active} 个进行中项目 · ${ts.length} 个任务</p><div class="subject-stats"><span>累计题量 <b>${totals.q||'—'}</b></span><span>总体正确率 <b>${totals.accuracy===null?'—':`${totals.accuracy}%`}</b></span></div></div><button class="more-btn" data-edit-subject="${s.id}">⋮</button></article>`;}).join(''):emptyState('还没有科目','科目用于组织项目、任务和统计。','add-subject','新建科目');
    }else renderMocks();
  }
  function projectCard(p){const s=subject(p.subjectId),x=projectTotals(p.id),pct=p.total?Math.min(100,Math.round(x.units/p.total*100)):0;return `<article class="project-card" style="--subject-color:${s?.color||'#aaa'}"><div class="project-head"><div><h3>${esc(p.name)}</h3><div class="project-sub">${esc(s?.name||'未知科目')}</div></div><button class="more-btn" data-project-menu="${p.id}">⋮</button></div><div class="progress"><i style="width:${pct}%;background:${s?.color||'#aaa'}"></i></div><div class="project-foot"><span>${x.units}/${p.total} ${esc(p.unit)}</span><b>${pct}%</b></div><div class="project-stats"><span>题量 <b>${x.q||'—'}</b></span><span>正确率 <b>${x.accuracy===null?'—':`${x.accuracy}%`}</b></span></div></article>`;}

  const mockPct=r=>r.maxScore>0?Math.round(r.score/r.maxScore*1000)/10:0;
  function mockStats(records){const sorted=[...records].sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||'').localeCompare(b.createdAt||'')),latest=sorted.at(-1),avg=records.length?records.reduce((n,r)=>n+mockPct(r),0)/records.length:0,best=records.length?Math.max(...records.map(mockPct)):0,avgDuration=records.length?records.reduce((n,r)=>n+(+r.durationMinutes||0),0)/records.length:0,q=records.reduce((n,r)=>n+(+r.questions||0),0),correct=records.reduce((n,r)=>n+(+r.correct||0),0);return{sorted,latest,avg:Math.round(avg*10)/10,best:Math.round(best*10)/10,avgDuration,accuracy:q?Math.round(correct/q*1000)/10:null};}
  function mockTrend(records){const xs=[...records].sort((a,b)=>a.date.localeCompare(b.date)).slice(-12);if(!xs.length)return emptyState('还没有趋势数据','新增第一场模考后，这里会显示成绩变化。');const w=320,h=130,left=20,right=300,top=12,bottom=108,points=xs.map((r,i)=>{const x=xs.length===1?(left+right)/2:left+i*(right-left)/(xs.length-1),y=bottom-mockPct(r)/100*(bottom-top);return{x,y,r};}),poly=points.map(p=>`${p.x},${p.y}`).join(' ');return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="得分率趋势"><line class="grid" x1="${left}" y1="${top}" x2="${right}" y2="${top}"/><line class="grid" x1="${left}" y1="${(top+bottom)/2}" x2="${right}" y2="${(top+bottom)/2}"/><line class="grid" x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}"/><polyline class="line" points="${poly}"/>${points.map(p=>`<circle class="point" cx="${p.x}" cy="${p.y}" r="4"><title>${fmtDate(p.r.date)} ${mockPct(p.r)}%</title></circle>`).join('')}<text x="${left}" y="125" font-size="9" fill="#85818b">${fmtDate(xs[0].date)}</text><text x="${right}" y="125" text-anchor="end" font-size="9" fill="#85818b">${fmtDate(xs.at(-1).date)}</text></svg>`;}
  function mockRecordCard(r){return `<button class="mock-record-card" data-mock-record="${r.id}"><div><h3>${esc(r.name)}</h3><p>${fmtFullDate(r.date)} · ${fmtDuration((+r.durationMinutes||0)*60000)}${r.questions?` · ${r.correct}/${r.questions}题`:''}</p></div><strong>${r.score}/${r.maxScore}</strong></button>`;}
  function renderMocks(){if(!state.mockSeries.some(x=>x.id===mockSeriesFilter))mockSeriesFilter=state.mockSeries[0]?.id||'';$('#mockSeriesFilters').innerHTML=state.mockSeries.map(s=>`<button class="${s.id===mockSeriesFilter?'active':''}" data-mock-series-filter="${s.id}">${esc(s.name)}</button>`).join('')+`<button data-action="add-mock-series">＋ 系列</button>`;if(!state.mockSeries.length){$('#mockContent').innerHTML=emptyState('还没有模考系列','先创建一个系列，例如国考行测或英语四级。','add-mock-series','创建模考系列');return;}const series=state.mockSeries.find(x=>x.id===mockSeriesFilter),records=state.mockRecords.filter(r=>r.seriesId===series.id),st=mockStats(records),latest=st.latest,previous=st.sorted.at(-2),change=latest&&previous?Math.round((mockPct(latest)-mockPct(previous))*10)/10:null;$('#mockContent').innerHTML=`<div class="mock-series-head"><div><h2>${esc(series.name)}</h2>${series.note?`<p>${esc(series.note)}</p>`:''}</div><div><button class="text-btn" data-edit-mock-series="${series.id}">编辑</button><button class="text-btn danger-text" data-delete-mock-series="${series.id}">删除</button><button class="text-btn" data-action="add-mock-record">＋ 记录</button></div></div>${records.length?`<div class="mock-summary">${statCard('最近成绩',`${latest.score}/${latest.maxScore}`)}${statCard('最高得分率',`${st.best}%`)}${statCard('平均得分率',`${st.avg}%`)}${statCard('平均用时',fmtDuration(st.avgDuration*60000))}${statCard('较上次',change===null?'—':`${change>0?'+':''}${change}%`)}${statCard('综合正确率',st.accuracy===null?'—':`${st.accuracy}%`)}</div><section class="mock-trend"><div class="section-title"><h2>成绩趋势</h2><span class="soft-chip">按得分率</span></div>${mockTrend(records)}</section><section><div class="section-title" style="margin:18px 2px 10px"><h2>最近记录</h2></div><div class="mock-record-list">${[...records].sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||'').localeCompare(a.createdAt||'')).map(mockRecordCard).join('')}</div></section>`:emptyState('还没有模考记录','记录第一场模考后查看成绩趋势。','add-mock-record','新增模考记录')}`;}

  function timelineHtml(date){const rs=state.records.filter(r=>r.date===date),segs=[];rs.forEach(r=>(r.segments||[]).forEach(s=>segs.push({r,s})));segs.sort((a,b)=>a.s.start-b.s.start);return segs.length?`<div class="timeline-line"></div>`+segs.map(({r,s})=>{const sub=recordSubject(r);return `<div class="timeline-segment"><div class="time-pair"><span>${fmtTime(s.start)}</span><span>${fmtTime(s.end)}</span></div><button class="time-block" style="background:${sub.color||'#ccc'}" data-record-detail="${r.id}">${esc(recordTitle(r))}</button></div>`}).join(''):`<div class="empty-inline">这一天还没有学习记录</div>`;}

  function renderStats(){
    $$('#statsTabs button').forEach(x=>x.classList.toggle('active',x.dataset.statsMode===statsMode));let start,end,label;if(statsMode==='day'){start=end=statsAnchor;label=fmtFullDate(start);}else if(statsMode==='week'){const d=parseDate(statsAnchor),shift=(d.getDay()+6)%7;start=addDays(statsAnchor,-shift);end=addDays(start,6);label=`${fmtDate(start)}—${fmtDate(end)}`;}else{const d=parseDate(statsAnchor);start=dateKey(new Date(d.getFullYear(),d.getMonth(),1,12));end=dateKey(new Date(d.getFullYear(),d.getMonth()+1,0,12));label=`${d.getFullYear()}年${d.getMonth()+1}月`;}$('#statsDateLabel').textContent=label;const st=periodStats(start,end),bd=breakdown(start,end);
    if(statsMode==='day'){$('#statsContent').innerHTML=`<div class="stats-cards">${statCard('学习时长',fmtDuration(st.totalMs))}${statCard('任务完成',`${st.done}/${st.totalTasks}`)}${statCard('完成题量',`${st.questions}题`)}${statCard('综合正确率',st.accuracy===null?'—':`${st.accuracy}%`)}</div><section class="donut-card"><div class="section-title"><h2>学习构成</h2><span class="soft-chip">${fmtDuration(st.totalMs)}</span></div>${donut(bd,st.totalMs)}</section><section class="card"><div class="section-title"><h2>每日时间轴</h2><button class="text-btn" data-action="add-record">＋ 手动添加学习记录</button></div><div class="journal-timeline">${journalTimeline(start)}</div></section>`;return;}
    const days=statsMode==='week'?7:daysBetween(start,end)+1,avg=st.studyDays?st.totalMs/st.studyDays:0;let html=`<div class="stats-cards">${statCard('学习总时长',fmtDuration(st.totalMs))}${statCard('学习天数',`${st.studyDays}天`)}${statCard('全部完成',`${st.completeDays}天`)}${statCard('日均时长',fmtDuration(avg))}${statCard('任务完成率',st.totalTasks?`${Math.round(st.done/st.totalTasks*100)}%`:'—')}${statCard('综合正确率',st.accuracy===null?'—':`${st.accuracy}%`)}</div><section class="donut-card"><div class="section-title"><h2>科目时长</h2><span class="soft-chip">${st.questions} 题</span></div>${bars(bd)||'<p class="muted">暂无学习记录</p>'}</section>`;
    if(statsMode==='week')html+=weekView(start);else html+=monthView(start,end);$('#statsContent').innerHTML=html;
  }
  const statCard=(name,val)=>`<div class="stat-card"><span>${name}</span><strong>${val}</strong></div>`;
  function donut(items,total){if(!total)return emptyState('暂无数据','当天有学习记录后显示科目构成。');let at=0,stops=[];items.forEach(x=>{const p=x.ms/total*100;stops.push(`${x.s.color} ${at}% ${at+p}%`);at+=p;});return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${stops.join(',')})"><strong>${fmtDuration(total)}</strong></div><div class="bar-list" style="flex:1">${items.map(x=>`<div class="bar-row" style="grid-template-columns:1fr auto"><span><i class="dot" style="background:${x.s.color}"></i> ${esc(x.s.name)}</span><b>${fmtDuration(x.ms)}</b></div>`).join('')}</div></div>`;}
  function weekView(start){const total=periodStats(start,addDays(start,6)).totalMs;return `<section class="card"><div class="section-title"><h2>每日学习时长</h2><span class="soft-chip">总计 ${fmtDuration(total)}</span></div>${timeChart(start,7)}</section>`;}
  function timeChart(start,count){const vals=[];for(let i=0;i<count;i++){const d=addDays(start,i);vals.push({d,ms:periodStats(d,d).totalMs});}const max=Math.max(1,...vals.map(x=>x.ms));return `<div class="chart-bars">${vals.map(x=>`<div class="chart-col"><i style="height:${Math.max(2,x.ms/max*105)}px"></i><span>${parseDate(x.d).getDate()}</span></div>`).join('')}</div>`;}
  function monthView(start,end){const first=parseDate(start),offset=(first.getDay()+6)%7,cells=[];for(let i=0;i<offset;i++)cells.push('<span></span>');let d=start;while(d<=end){const st=periodStats(d,d),status=dayTaskStatus(d);cells.push(`<button class="day-cell ${status}" data-open-day="${d}"><b>${parseDate(d).getDate()}</b><small>${st.totalMs?fmtDuration(st.totalMs):'0分'}</small><small>${st.accuracy===null?'—':`${st.accuracy}%`}</small></button>`);d=addDays(d,1);}const active=state.projects.filter(p=>!projectEnded(p));return `<section class="calendar"><div class="calendar-head">${['一','二','三','四','五','六','日'].map(x=>`<span>${x}</span>`).join('')}</div><div class="calendar-grid">${cells.join('')}</div><div class="legend"><span><i style="background:var(--good)"></i>全部完成</span><span><i style="background:var(--bad)"></i>有未完成</span><span><i style="background:var(--today)"></i>进行中</span><span><i style="background:var(--idle)"></i>无任务</span></div></section><section class="card"><div class="section-title"><h2>每日学习时长</h2></div>${timeChart(start,daysBetween(start,end)+1)}</section><section><div class="section-title" style="margin:20px 2px 12px"><h2>学习项目</h2></div><div class="project-list">${active.length?active.map(projectCard).join(''):'<p class="muted">暂无进行中的项目</p>'}</div></section>`;}

  const allReviewTags=()=>[...new Set(state.reviews.flatMap(r=>r.tags||[]))].sort();
  function reviewCard(r){const s=subject(r.subjectId);return `<article class="review-card"><div class="project-head"><div><h3>${esc(r.title)}</h3><small>${esc(s?.name||'未知科目')} · ${fmtFullDate(r.date)}</small></div><button class="more-btn" data-review-menu="${r.id}">⋮</button></div><div class="review-tags">${(r.tags||[]).map(t=>`<span>#${esc(t)}</span>`).join('')}</div><p>${esc(r.content||'')}</p></article>`;}
  function renderReviews(){
    $$('#reviewTabs button').forEach(x=>x.classList.toggle('active',x.dataset.reviewView===reviewView));$('#reviewRecent').classList.toggle('hidden',reviewView!=='recent');$('#reviewArchive').classList.toggle('hidden',reviewView!=='archive');$('#reviewTags').classList.toggle('hidden',reviewView!=='tags');
    const allTags=allReviewTags();$('#reviewSubjectFilter').innerHTML='<option value="">全部科目</option>'+state.subjects.map(s=>`<option value="${s.id}" ${reviewSubject===s.id?'selected':''}>${esc(s.name)}</option>`).join('');$('#reviewTagFilter').innerHTML='<option value="">全部标签</option>'+allTags.map(t=>`<option value="${esc(t)}" ${reviewTag===t?'selected':''}>${esc(t)}</option>`).join('');$('#reviewSearch').value=reviewSearch;
    let rs=[...state.reviews].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));if(reviewSubject)rs=rs.filter(r=>r.subjectId===reviewSubject);if(reviewTag)rs=rs.filter(r=>(r.tags||[]).includes(reviewTag));if(reviewMonth)rs=rs.filter(r=>r.date.startsWith(reviewMonth));if(reviewSearch){const q=reviewSearch.toLowerCase();rs=rs.filter(r=>`${r.title} ${r.content} ${(r.tags||[]).join(' ')} ${subject(r.subjectId)?.name||''}`.toLowerCase().includes(q));}
    $('#reviewList').innerHTML=rs.length?rs.slice(0,reviewLimit).map(reviewCard).join(''):emptyState('没有找到复盘记录','可以调整筛选条件或新增一条复盘。','add-review','新增复盘');$('#reviewMore').classList.toggle('hidden',rs.length<=reviewLimit);
    $$('#reviewArchive [data-archive-mode]').forEach(x=>x.classList.toggle('active',x.dataset.archiveMode===reviewArchiveMode));const groups={};if(reviewArchiveMode==='subject'){state.reviews.forEach(r=>{const k=r.subjectId;groups[k]=groups[k]||[];groups[k].push(r);});$('#archiveList').innerHTML=Object.entries(groups).map(([id,items])=>{const s=subject(id),counts={};items.forEach(r=>(r.tags||[]).forEach(t=>counts[t]=(counts[t]||0)+1));const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,2).map(x=>x[0]).join('、');return `<button class="folder-card" data-review-folder="subject" data-folder-value="${id}"><span class="folder-icon" style="background:${s?.color||'#bbb'}">▰</span><span><b>${esc(s?.name||'未知科目')}</b><small>${items.length}条${top?` · 常见：${esc(top)}`:''}</small></span><i>›</i></button>`;}).join('')||emptyState('档案柜还是空的','保存复盘后会自动按照科目归档。');}else{state.reviews.forEach(r=>{const k=r.date.slice(0,7);groups[k]=groups[k]||[];groups[k].push(r);});$('#archiveList').innerHTML=Object.entries(groups).sort((a,b)=>b[0].localeCompare(a[0])).map(([month,items])=>{const [y,m]=month.split('-');return `<button class="folder-card" data-review-folder="time" data-folder-value="${month}"><span class="folder-icon">▰</span><span><b>${y}年${+m}月</b><small>${items.length}条复盘记录</small></span><i>›</i></button>`;}).join('')||emptyState('档案柜还是空的','保存复盘后会自动按照时间归档。');}
    const counts={};state.reviews.forEach(r=>(r.tags||[]).forEach(t=>counts[t]=(counts[t]||0)+1));const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]);$('#tagStats').innerHTML=sorted.length?sorted.map(([t,n])=>`<button class="tag-pill" data-review-tag="${esc(t)}">${esc(t)} · ${n}次</button>`).join(''):'<span class="muted">暂无标签统计</span>';$('#tagAdvice').textContent=sorted.length?`“${sorted[0][0]}”出现最频繁，点击标签可以集中回看相关记录。`:'';
  }

  const MOODS=['😞','😕','😐','🙂','😄'],JOURNAL_STATES=['专注','焦虑','疲惫','平静','开心','拖延'],WEATHERS=['晴','多云','阴','雨','雪'];
  const journalDay=date=>state.journal.days[date]||{};
  function updateJournalDay(date,patch){state.journal.days[date]={...journalDay(date),...patch};save();renderJournal();}
  const eventType=id=>state.journal.eventTypes.find(x=>x.id===id);
  const eventStamp=e=>new Date(`${e.date}T${e.time||'00:00'}`).getTime();
  function dueQuestions(date){const day=parseDate(date).getDay();return state.journal.questions.filter(q=>q.active!==false&&(q.schedule==='daily'||(q.weekdays||[]).includes(day)));}
  function journalAnswer(qid,date){return state.journal.answers.find(a=>a.questionId===qid&&a.date===date);}
  function journalChoice(field,options,current,multi=false){const selected=multi?(current||[]):[current];return `<div class="choice-row">${options.map(v=>`<button class="choice-chip ${selected.includes(v)?'active':''}" data-journal-field="${field}" data-journal-value="${esc(v)}" data-multi="${multi}">${esc(v)}</button>`).join('')}</div>`;}
  function renderJournal(){
    $$('#journalTabs button').forEach(x=>x.classList.toggle('active',x.dataset.journalView===journalView));$('#journalToday').classList.toggle('hidden',journalView!=='today');$('#journalHistory').classList.toggle('hidden',journalView!=='history');$('#journalSettings').classList.toggle('hidden',journalView!=='settings');$('#journalDateLabel').textContent=fmtFullDate(journalDate);
    renderJournalToday();renderJournalHistory();renderJournalSettings();
  }
  function renderJournalToday(){
    const box=$('#journalTodayContent');if(journalDate>today()){box.innerHTML=emptyState('未来日期还不能记录','请选择今天或过去日期。');return;}const d=journalDay(journalDate),st=periodStats(journalDate,journalDate),events=state.journal.events.filter(e=>e.date===journalDate),notes=state.journal.notes.filter(n=>n.date===journalDate),questions=dueQuestions(journalDate);
    const checkins=`<section class="card"><div class="section-title"><h2>生活打卡</h2><span class="soft-chip">${events.length}条</span></div><div class="checkin-grid">${state.journal.eventTypes.filter(x=>x.active!==false).map(x=>`<button data-quick-event="${x.id}">${esc(x.name)}</button>`).join('')}</div></section>`;
    const asks=`<section class="card"><div class="section-title"><h2>今天问问自己</h2><span class="soft-chip">离开文本框后自动保存</span></div><div class="question-stack">${questions.length?questions.map(q=>{const a=journalAnswer(q.id,journalDate);if(q.type==='choice')return `<article class="question-card"><b>${esc(q.text)}</b><div class="choice-row">${(q.choices||['是','一般','没有']).map(c=>`<button class="choice-chip ${a?.value===c?'active':''}" data-question-choice="${q.id}" data-choice="${esc(c)}">${esc(c)}</button>`).join('')}</div><button class="text-btn" data-skip-question="${q.id}">${a?.skipped?'已跳过':'跳过今天'}</button></article>`;return `<article class="question-card"><b>${esc(q.text)}</b><textarea class="direct-answer" data-question-answer="${q.id}" placeholder="在这里直接写下回答……" ${a?.skipped?'disabled':''}>${esc(a?.value||'')}</textarea><button class="text-btn" data-skip-question="${q.id}">${a?.skipped?'取消跳过':'跳过今天'}</button></article>`;}).join(''):emptyState('今天没有自问问题','可以在日记设置中创建每天或指定星期出现的问题。','add-question','创建一个问题')}</div></section>`;
    box.innerHTML=status+checkins+asks;
  }
  function sleepSegmentsFor(date){const all=[...state.journal.events].sort((a,b)=>eventStamp(a)-eventStamp(b)),out=[],startDay=new Date(`${date}T00:00`).getTime(),endDay=new Date(`${addDays(date,1)}T00:00`).getTime();all.forEach((e,i)=>{if(e.typeId!=='event_sleep')return;const start=eventStamp(e),wake=all.slice(i+1).find(x=>x.typeId==='event_wake'&&eventStamp(x)>start&&eventStamp(x)-start<=36*3600000);if(!wake)return;const end=eventStamp(wake);if(start<endDay&&end>startDay)out.push({start:Math.max(start,startDay),end:Math.min(end,endDay)});});return out;}
  function journalTimeline(date){const items=[],sleepSegments=sleepSegmentsFor(date);state.records.filter(r=>r.date===date).forEach(r=>(r.segments||[]).forEach(s=>items.push({type:'study',start:s.start,end:s.end,r})));state.journal.events.filter(e=>e.date===date).forEach(e=>{const represented=e.typeId==='event_sleep'&&sleepSegments.some(s=>s.start===eventStamp(e));if(!represented)items.push({type:'event',start:eventStamp(e),e});});state.journal.notes.filter(n=>n.date===date).forEach(n=>items.push({type:'note',start:new Date(`${n.date}T${n.time}`).getTime(),n}));sleepSegments.forEach(s=>items.push({type:'sleep',...s}));items.sort((a,b)=>a.start-b.start||(a.type==='sleep'?-1:1));if(!items.length)return emptyState('这一天还没有时间轴记录','可以打卡、写随手记或补录学习时间。');return items.map(x=>{if(x.type==='study'){const sub=recordSubject(x.r),mins=Math.max(1,(x.end-x.start)/60000),h=Math.max(40,Math.min(190,mins*.8));return `<div class="journal-line"><time>${fmtTime(x.start)}<small>${fmtTime(x.end)}</small></time><button class="timeline-card study" style="--line-color:${sub.color||'#aaa'};min-height:${h}px" data-record-detail="${x.r.id}"><b>${esc(recordTitle(x.r))}</b><span>${esc(sub.name||'')}</span></button></div>`;}if(x.type==='sleep'){const mins=(x.end-x.start)/60000,h=Math.max(46,Math.min(360,mins*.8));return `<div class="journal-line"><time>${fmtTime(x.start)}<small>${fmtTime(x.end)}</small></time><div class="timeline-card sleep" style="min-height:${h}px"><b>睡觉</b></div></div>`;}if(x.type==='event')return `<div class="journal-line point"><time>${fmtTime(x.start)}</time><button class="timeline-card event" data-journal-event-menu="${x.e.id}"><b>${esc(eventType(x.e.typeId)?.name||'生活记录')}</b></button></div>`;return `<div class="journal-line point"><time>${fmtTime(x.start)}</time><button class="timeline-card note" data-note-menu="${x.n.id}"><b>随手记</b><span>${esc(x.n.text)}</span></button></div>`;}).join('');}
  function renderJournalHistory(){const dates=new Set([...Object.keys(state.journal.days),...state.journal.events.map(x=>x.date),...state.journal.notes.map(x=>x.date),...state.records.map(x=>x.date)]),sorted=[...dates].sort((a,b)=>b.localeCompare(a));$('#journalHistoryList').innerHTML=sorted.length?sorted.map(date=>{const d=journalDay(date),notes=state.journal.notes.filter(n=>n.date===date).sort((a,b)=>b.time.localeCompare(a.time)),events=state.journal.events.filter(e=>e.date===date),st=periodStats(date,date),preview=notes[0]?.text|| (events.length?`记录了 ${events.slice(0,4).map(e=>eventType(e.typeId)?.name).filter(Boolean).join('、')}`:'');return `<button class="journal-day-card" data-open-journal-day="${date}"><div><b>${fmtFullDate(date)}</b><span>${esc([d.mood,(d.states||[]).join('、'),d.weather].filter(Boolean).join(' · ')||'未记录状态')}</span></div><strong>${fmtDuration(st.totalMs)}</strong>${d.keywords?`<small>关键词：${esc(d.keywords)}</small>`:''}${preview?`<p>${esc(preview)}</p>`:''}</button>`;}).join(''):emptyState('还没有日记','从今天的心情、打卡或随手记开始。');}
  function renderJournalSettings(){$('#eventTypeList').innerHTML=state.journal.eventTypes.map(x=>`<div class="settings-row"><button data-edit-event-type="${x.id}"><b>${esc(x.name)}</b><br><small>${x.active===false?'已停用':'使用中'}</small></button><button class="icon-btn" data-toggle-event-type="${x.id}">${x.active===false?'＋':'—'}</button></div>`).join('');$('#questionList').innerHTML=state.journal.questions.length?state.journal.questions.map(q=>`<div class="settings-row"><button data-edit-question="${q.id}"><b>${esc(q.text)}</b><br><small>${q.schedule==='daily'?'每天':`每周 ${(['日','一','二','三','四','五','六']).filter((_,i)=>(q.weekdays||[]).includes(i)).join('、')}`} · ${q.type==='choice'?'选择':'文本'}</small></button><button class="icon-btn" data-toggle-question="${q.id}">${q.active===false?'＋':'—'}</button></div>`).join(''):'<p class="muted">还没有自问问题</p>';}

  function openForm(type,id='',extra={}){
    formCtx={type,id,...extra};$('#formError').textContent='';const edit=!!id;const titles={countdown:'倒计时',stage:'阶段',subject:'科目',task:'任务',project:'学习项目',record:'学习记录',timerResult:'保存学习记录',mockSeries:'模考系列',mockRecord:'模考记录',review:'复盘记录',journalNote:'随手记',journalEvent:'生活记录',eventType:'打卡项目',question:'自问问题',answer:'回答'};$('#formKicker').textContent=edit?'EDIT':'NEW';$('#formTitle').textContent=type==='timerResult'?'保存学习记录':`${edit?'编辑':'新增'}${titles[type]}`;$('#formSubmit').textContent='保存';let html='';
    if(type==='countdown'){const x=state.countdowns.find(x=>x.id===id);html=`${field('name','名称 *',x?.name||'','例如：公务员考试')}${field('date','日期 *',x?.date||today(),'','date')}${area('note','备注（可选）',x?.note||'','写下需要记住的信息')}`;}
    if(type==='stage'){const c=state.countdowns.find(x=>x.id===extra.countdownId),x=c?.stages?.find(s=>s.id===id);html=`${field('name','阶段名称 *',x?.name||'','例如：资料分析专项')}${row(field('start','开始日期 *',x?.start||today(),'','date'),field('end','结束日期 *',x?.end||today(),'','date'))}`;}
    if(type==='subject'){const x=subject(id);html=`${field('name','科目名称 *',x?.name||'','例如：资料分析')}${field('color','科目颜色',x?.color||COLORS[state.subjects.length%COLORS.length],'','color')}`;}
    if(type==='task'){const x=task(id),r=x?.repeat||'none';html=`${field('title','任务名称 *',x?.title||'','今天要做什么？')}${subjectSelect(x?.subjectId||'')}${field('startDate',r==='none'?'任务日期 *':'开始日期 *',x?.startDate||today(),'','date')}${selectField('repeat','重复方式',[['none','不重复'],['daily','每天'],['weekdays','工作日'],['weekly','每周指定星期']],r)}<div id="weeklyFields" class="${r==='weekly'?'':'hidden'}">${weekdayPicker(x?.weekdays||[])}</div><div id="repeatEnd" class="${r==='none'?'hidden':''}">${field('endDate','结束日期（可选）',x?.endDate||'','','date')}</div>`;}
    if(type==='project'){const x=project(id),unit=['节','套','题','篇'].includes(x?.unit)?x.unit:'custom';html=`${field('name','项目名称 *',x?.name||'','例如：高数系统课')}${subjectSelect(x?.subjectId||extra.prefillSubjectId||'')}${row(field('total','总数量 *',x?.total||'','','number','1'),field('initialProgress','已有完成数量',x?.initialProgress||0,'不产生学习时间','number','0'))}${selectField('unit','单位',[['节','节'],['套','套'],['题','题'],['篇','篇'],['custom','自定义']],unit)}<div id="customUnit" class="${unit==='custom'?'':'hidden'}">${field('customUnit','自定义单位 *',unit==='custom'?(x?.unit||''):'','最多4个字')}</div><div class="field-row">${field('initialQuestions','已有题量（可选）',x?.initialQuestions||'','例如：200','number','0')}${field('initialAccuracy','已有正确率 %（可选）',x?.initialAccuracy??'','例如：75','number','0')}</div><p class="help">已有题量和正确率需要同时填写，用于计算项目及科目的加权正确率；不会生成学习时间。</p>`;}
    if(type==='record'){const x=state.records.find(r=>r.id===id),timerSource=x?.source==='timer';if(timerSource){html=`<p class="help">计时产生的时间段保持不变，可以修改项目与做题数据。</p>${projectSelect(x.subjectId,x.projectId,true)}${field('units','本次完成数量',x.units||'','','number','0')}${row(field('questions','题量（可选）',x.questions||'','','number','0'),field('wrong','错题数',x.wrong||0,'','number','0'))}`;}else{const date=x?.date||recordDate,start=x?fmtTime(x.segments[0].start):'09:00',end=x?fmtTime(x.segments[0].end):'10:00',selectedSubjectId=x?.subjectId||task(x?.taskId)?.subjectId||state.subjects[0]?.id||'',selectedTaskId=x?.taskId||'';html=`${field('date','日期 *',date,'','date')}${row(timePicker('start','开始时间 *',start),timePicker('end','结束时间 *',end))}${subjectSelect(selectedSubjectId)}<div id="recordTask">${recordTaskSelect(selectedSubjectId,selectedTaskId)}</div><div id="recordProject">${projectSelect(selectedSubjectId,x?.projectId||'',!!x)}</div>${field('units','本次完成数量',x?.units||'','','number','0')}${row(field('questions','题量（可选）',x?.questions||'','','number','0'),field('wrong','错题数',x?.wrong||0,'','number','0'))}<p class="help">任务为可选项。学习记录和任务完成状态彼此独立。</p>`;}}
    if(type==='timerResult'){const t=task(state.timer.taskId);html=`<div class="metric"><span>实际学习时长</span><strong>${fmtDuration(timerElapsed())}</strong></div>${projectSelect(t.subjectId,'',false)}${field('units','本次完成数量','','','number','0')}${row(field('questions','题量（可选）','','','number','0'),field('wrong','错题数','','','number','0'))}<p class="help">保存学习记录不会自动完成任务，任务状态请单独勾选。</p>`;}
    if(type==='mockSeries'){const x=state.mockSeries.find(s=>s.id===id);html=`${field('name','系列名称 *',x?.name||'','例如：国考行测')}${area('note','备注（可选）',x?.note||'','例如：每周全真模拟')}`;}
    if(type==='mockRecord'){const x=state.mockRecords.find(r=>r.id===id),seriesId=x?.seriesId||extra.seriesId||mockSeriesFilter||state.mockSeries[0]?.id||'',duration=+x?.durationMinutes||0;html=`${selectField('seriesId','模考系列 *',state.mockSeries.map(s=>[s.id,s.name]),seriesId)}${field('name','模考名称 *',x?.name||'','例如：2026 国考行测第 1 套')}${field('date','日期 *',x?.date||today(),'','date')}${row(numberField('score','得分 *',x?.score??'',0,'',0.1),numberField('maxScore','满分 *',x?.maxScore??100,0.1,'',0.1))}${row(numberField('durationHours','用时（小时）',Math.floor(duration/60),0,23,1),numberField('durationMinutesPart','用时（分钟）',duration%60,0,59,1))}${row(numberField('questions','题量（可选）',x?.questions||'',0,'',1),numberField('correct','正确题数（可选）',x?.correct||'',0,'',1))}<div class="inline-action"><span class="help">分模块成绩（可选）</span><button type="button" data-add-mock-section>＋ 增加模块</button></div><div id="mockSections">${(x?.sections||[]).map(mockSectionRow).join('')}</div>${area('note','备注（可选）',x?.note||'','记录本次模考的特殊情况……')}`;}
    if(type==='review'){const x=state.reviews.find(r=>r.id===id);html=`<div class="field"><span>记录日期</span><input value="${x?.date||today()}" disabled><small class="help">日期自动记录当天，不能修改。</small></div>${subjectSelect(x?.subjectId||'')}${field('title','标题 *',x?.title||'','例如：增长量计算题')}${reviewTagPicker(x?.tags||[])}${area('content','内容',x?.content||'','可以记录对应的题目、知识点、错误原因、正确方法，以及给自己的建议……')}`;}
    if(type==='journalNote'){const x=state.journal.notes.find(n=>n.id===id),now=new Date(),time=x?.time||`${pad(now.getHours())}:${pad(now.getMinutes())}`;html=`${field('date','日期 *',x?.date||extra.date||journalDate,'','date')}${timePicker('time','时间 *',time)}${area('text','随手记内容 *',x?.text||'','想到什么就写什么……')}`;}
    if(type==='journalEvent'){const x=state.journal.events.find(n=>n.id===id),now=new Date(),time=x?.time||`${pad(now.getHours())}:${pad(now.getMinutes())}`,types=state.journal.eventTypes.filter(t=>t.active!==false||t.id===x?.typeId);html=`${field('date','日期 *',x?.date||extra.date||journalDate,'','date')}${timePicker('time','时间 *',time)}${selectField('typeId','打卡项目 *',types.map(t=>[t.id,t.name]),x?.typeId||extra.typeId||types[0]?.id||'')}`;}
    if(type==='eventType'){const x=state.journal.eventTypes.find(n=>n.id===id);html=field('name','打卡项目名称 *',x?.name||'','例如：运动、吃药、午休');}
    if(type==='question'){const x=state.journal.questions.find(n=>n.id===id),schedule=x?.schedule||'daily',kind=x?.type||'text';html=`${field('text','问题内容 *',x?.text||'','例如：今天最值得感谢的事情是什么？')}${selectField('type','回答方式',[['text','自由文本'],['choice','三个选项']],kind)}<div id="questionChoices" class="${kind==='choice'?'':'hidden'}">${field('choices','三个选项 *',(x?.choices||['是','一般','没有']).join('，'),'用逗号分开')}</div>${selectField('schedule','出现频率',[['daily','每天'],['weekly','指定星期']],schedule)}<div id="questionWeekdays" class="${schedule==='weekly'?'':'hidden'}">${weekdayPicker(x?.weekdays||[])}</div>`;}
    if(type==='answer'){const q=state.journal.questions.find(q=>q.id===extra.questionId),a=journalAnswer(extra.questionId,extra.date||journalDate);html=`<p class="help">${esc(q?.text||'')}</p>${area('value','回答',a?.value||'','写下此刻真实的想法……')}`;}
    $('#formFields').innerHTML=html;restoreDraft();$('#formDialog').showModal();setTimeout(()=>$('#formFields input:not([disabled]),#formFields select')?.focus(),80);
  }
  const field=(name,label,value='',placeholder='',type='text',min='')=>`<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${min!==''?`min="${min}"`:''}></label>`;
  const numberField=(name,label,value='',min='',max='',step='1')=>`<label class="field"><span>${label}</span><input name="${name}" type="number" value="${esc(value)}" ${min!==''?`min="${min}"`:''} ${max!==''?`max="${max}"`:''} step="${step}"></label>`;
  const area=(name,label,value='',placeholder='')=>`<label class="field"><span>${label}</span><textarea name="${name}" placeholder="${esc(placeholder)}">${esc(value)}</textarea></label>`;
  const row=(a,b)=>`<div class="field-row">${a}${b}</div>`;
  const selectField=(name,label,options,value)=>`<label class="field"><span>${label}</span><select name="${name}">${options.map(([v,l])=>`<option value="${v}" ${v===value?'selected':''}>${l}</option>`).join('')}</select></label>`;
  function timePicker(name,label,value='00:00'){const [hour='00',minute='00']=String(value).split(':');const hours=Array.from({length:24},(_,i)=>pad(i)),minutes=Array.from({length:60},(_,i)=>pad(i));return `<label class="field"><span>${label}</span><span class="time-picker"><select name="${name}Hour" aria-label="${label}小时">${hours.map(v=>`<option value="${v}" ${v===hour?'selected':''}>${v}</option>`).join('')}</select><i>时</i><select name="${name}Minute" aria-label="${label}分钟">${minutes.map(v=>`<option value="${v}" ${v===minute?'selected':''}>${v}</option>`).join('')}</select><i>分</i></span></label>`;}
  const pickedTime=(data,name)=>data[`${name}Hour`]!==undefined&&data[`${name}Minute`]!==undefined?`${pad(+data[`${name}Hour`])}:${pad(+data[`${name}Minute`])}`:'';
  const subjectSelect=value=>`<div class="inline-action"><span class="help">对应科目 *</span><button type="button" data-action="quick-subject">＋ 新增科目</button></div>${selectField('subjectId','',state.subjects.map(s=>[s.id,s.name]),value)}`;
  const recordTaskSelect=(subjectId,value)=>selectField('taskId','对应任务（可选）',[['','不关联任务'],...state.tasks.filter(t=>t.subjectId===subjectId).map(t=>[t.id,t.title])],value||'');
  function projectSelect(subjectId,value,includeCurrent){const ps=state.projects.filter(p=>p.subjectId===subjectId&&(!projectEnded(p)||(includeCurrent&&p.id===value)));return `<div class="inline-action"><span class="help">学习项目（可选）</span><button type="button" data-action="quick-project">＋ 新增项目</button></div>${selectField('projectId','',[['','不关联项目'],...ps.map(p=>[p.id,p.name])],value||'')}`;}
  const mockSectionRow=(x={})=>`<div class="mock-section-row"><input name="sectionName" value="${esc(x.name||'')}" placeholder="模块名称"><input name="sectionScore" type="number" min="0" step="0.1" value="${esc(x.score??'')}" placeholder="得分"><input name="sectionMax" type="number" min="0.1" step="0.1" value="${esc(x.maxScore??'')}" placeholder="满分"><button type="button" class="remove-row" data-remove-mock-section aria-label="删除模块">×</button></div>`;
  function reviewTagPicker(selected=[]){const tags=allReviewTags();return `<div class="field"><span>错误原因标签 *</span><details class="tag-dropdown"><summary>${selected.length?`已选择 ${selected.length} 个标签`:'选择已有标签'}</summary><div class="tag-options">${tags.length?tags.map(t=>`<label><input type="checkbox" name="reviewTags" value="${esc(t)}" ${selected.includes(t)?'checked':''}><span>${esc(t)}</span></label>`).join(''):'<p class="help">还没有标签，可以在下方直接新增。</p>'}</div></details>${field('newTags','新增标签（可选）','','多个标签用逗号分开')}</div>`;}
  function weekdayPicker(vals){return `<label class="field"><span>重复星期 *</span><div class="weekday-picker">${[['一',1],['二',2],['三',3],['四',4],['五',5],['六',6],['日',0]].map(([l,v])=>`<label><input type="checkbox" name="weekdays" value="${v}" ${vals.includes(v)?'checked':''}><span>${l}</span></label>`).join('')}</div></label>`;}

  function submitForm(e){
    e.preventDefault();const fd=new FormData(e.currentTarget),data=Object.fromEntries(fd);Object.keys(data).forEach(k=>typeof data[k]==='string'&&(data[k]=data[k].trim()));const {type,id}=formCtx;const fail=m=>{$('#formError').textContent=m;};
    if(type==='countdown'){if(!data.name||!data.date)return fail('请填写名称和日期。');upsert('countdowns',id,{name:data.name,date:data.date,note:data.note,stages:id?(state.countdowns.find(x=>x.id===id)?.stages||[]):[]},'countdown');}
    if(type==='stage'){if(!data.name||!data.start||!data.end)return fail('请填写阶段名称和日期。');if(data.end<data.start)return fail('结束日期不能早于开始日期。');const c=state.countdowns.find(x=>x.id===formCtx.countdownId);c.stages=c.stages||[];if(id){Object.assign(c.stages.find(x=>x.id===id),{name:data.name,start:data.start,end:data.end});}else c.stages.push({id:uid('stage'),name:data.name,start:data.start,end:data.end});save();closeForm();render();openCountdownDetail(c.id);toast('阶段已保存。');return;}
    if(type==='subject'){if(!data.name)return fail('请填写科目名称。');if(state.subjects.some(s=>s.name===data.name&&s.id!==id))return fail('已经存在同名科目。');if(!id&&pendingSubjectReturn){const created={id:uid('subject'),name:data.name,color:data.color||COLORS[0],createdAt:new Date().toISOString()},back=pendingSubjectReturn;state.subjects.push(created);pendingSubjectReturn=null;save();closeForm();render();openForm(back.ctx.type,back.ctx.id,back.ctx);restoreForm(back.values,'',created.id);toast('科目已新增，并已自动选中。');return;}upsert('subjects',id,{name:data.name,color:data.color||COLORS[0]},'subject');}
    if(type==='task'){if(!data.title||!data.subjectId||!data.startDate)return fail('请填写任务名称、科目和日期。');if(data.repeat==='weekly'){data.weekdays=fd.getAll('weekdays').map(Number);if(!data.weekdays.length)return fail('请至少选择一个星期。');}else data.weekdays=[];if(data.endDate&&data.endDate<data.startDate)return fail('结束日期不能早于开始日期。');const payload={title:data.title,subjectId:data.subjectId,startDate:data.startDate,repeat:data.repeat,endDate:data.repeat==='none'?data.startDate:(data.endDate||''),weekdays:data.weekdays};if(id){const old=task(id);if(old.startDate<today()){old.endDate=addDays(today(),-1);const newPayload={...payload,startDate:today(),endDate:data.repeat==='none'?today():(data.endDate>=today()?data.endDate:'')};state.tasks.push({...newPayload,id:uid('task'),createdAt:new Date().toISOString()});}else Object.assign(old,payload);save();closeForm();render();toast('任务已更新。');return;}state.tasks.push({...payload,id:uid('task'),createdAt:new Date().toISOString()});save();closeForm();render();toast('任务已添加。');return;}
    if(type==='project'){if(!data.name||!data.subjectId||!(+data.total>0))return fail('请填写项目名称、科目和总数量。');if((+data.initialProgress||0)<0)return fail('已有完成数量不能为负数。');if((+data.initialProgress||0)>+data.total)return fail('已有完成数量不能超过总数量。');const hasQ=data.initialQuestions!==''&&data.initialQuestions!==undefined,hasAccuracy=data.initialAccuracy!==''&&data.initialAccuracy!==undefined;if(hasQ!==hasAccuracy)return fail('已有题量和已有正确率需要同时填写或同时留空。');if(hasQ&&(+data.initialQuestions<=0||+data.initialAccuracy<0||+data.initialAccuracy>100))return fail('已有题量必须大于0，正确率需在0%到100%之间。');if(formCtx.returnTo&&data.subjectId!==formCtx.prefillSubjectId)return fail('新项目需要与当前任务属于同一科目。');const unit=data.unit==='custom'?data.customUnit:data.unit;if(!unit)return fail('请填写自定义单位。');if(unit.length>4)return fail('单位最多4个字。');const recorded=id?projectTotals(id).units-(+project(id).initialProgress||0):0;if(id&&+data.total<recorded+(+data.initialProgress||0))return fail('总数量不能小于已有进度与学习记录之和。');const payload={name:data.name,subjectId:data.subjectId,total:+data.total,initialProgress:+data.initialProgress||0,initialQuestions:hasQ?+data.initialQuestions:0,initialAccuracy:hasAccuracy?+data.initialAccuracy:null,unit,manualEnded:id?project(id).manualEnded:false};if(!id&&formCtx.returnTo&&pendingReturn){const created={...payload,id:uid('project'),createdAt:new Date().toISOString()};state.projects.push(created);save();closeForm();render();const back=pendingReturn;pendingReturn=null;openForm(back.ctx.type,back.ctx.id,back.ctx);restoreForm(back.values,created.id);toast('项目已新增，并已自动选中。');return;}upsert('projects',id,payload,'project');}
    if(type==='timerResult'){const t=task(state.timer.taskId);if(!t)return fail('原任务已不存在，暂时无法保存这次计时。');const s=subject(t.subjectId),p=data.projectId?project(data.projectId):null;if(p&&!(+data.units>=0))return fail('请填写本次完成数量。');if(!validateQuestions(data,fail))return;const segs=[...state.timer.segments];const rec={id:uid('record'),taskId:t.id,taskTitle:t.title,subjectId:t.subjectId,subjectName:s?.name||'',subjectColor:s?.color||'#aaa',date:dateKey(new Date(segs[0].start)),segments:segs,projectId:data.projectId||'',units:p?(+data.units||0):0,questions:+data.questions||0,wrong:+data.wrong||0,source:'timer',createdAt:new Date().toISOString()};state.records.push(rec);state.timer=blank().timer;save();closeForm();render();toast('学习记录已保存，任务状态未改变。');return;}
    if(type==='record'){const existing=state.records.find(r=>r.id===id);if(existing?.source==='timer'){if(!validateQuestions(data,fail))return;Object.assign(existing,{projectId:data.projectId||'',units:data.projectId?(+data.units||0):0,questions:+data.questions||0,wrong:+data.wrong||0});save();closeForm();render();toast('记录已更新。');return;}const startTime=pickedTime(data,'start'),endTime=pickedTime(data,'end');if(!data.date||!startTime||!endTime||!data.subjectId)return fail('请填写日期、时间并选择科目。');const start=new Date(`${data.date}T${startTime}`).getTime(),end=new Date(`${data.date}T${endTime}`).getTime();if(end<=start)return fail('结束时间必须晚于开始时间。');if(overlaps(start,end,id))return fail('这个时间段与已有学习记录重叠。');if(!validateQuestions(data,fail))return;const t=data.taskId?task(data.taskId):null,s=subject(data.subjectId),p=data.projectId?project(data.projectId):null;if(!s)return fail('请选择有效科目。');if(t&&t.subjectId!==s.id)return fail('任务与科目不一致，请重新选择。');if(p&&p.subjectId!==s.id)return fail('项目与科目不一致，请重新选择。');const payload={taskId:t?.id||'',taskTitle:t?.title||'',subjectId:s.id,subjectName:s.name,subjectColor:s.color,date:data.date,segments:[{start,end}],projectId:p?.id||'',units:p?(+data.units||0):0,questions:+data.questions||0,wrong:+data.wrong||0,source:'manual'};if(id)Object.assign(existing,payload);else state.records.push({...payload,id:uid('record'),createdAt:new Date().toISOString()});save();closeForm();render();toast(id?'记录已更新。':'记录已添加。');return;}
    if(type==='mockSeries'){if(!data.name)return fail('请填写系列名称。');if(state.mockSeries.some(s=>s.name===data.name&&s.id!==id))return fail('已经存在同名模考系列。');upsert('mockSeries',id,{name:data.name,note:data.note||''},'mockSeries');if(!mockSeriesFilter)mockSeriesFilter=state.mockSeries.at(-1)?.id||id;return;}
    if(type==='mockRecord'){if(!data.seriesId||!data.name||!data.date||data.score===''||data.maxScore==='')return fail('请填写系列、名称、日期、得分和满分。');const score=+data.score,maxScore=+data.maxScore,durationMinutes=(+data.durationHours||0)*60+(+data.durationMinutesPart||0);if(score<0||maxScore<=0||score>maxScore)return fail('得分需在 0 到满分之间。');if(durationMinutes<=0)return fail('请填写大于 0 分钟的模考用时。');const hasQ=data.questions!==''&&data.questions!==undefined,hasCorrect=data.correct!==''&&data.correct!==undefined;if(hasQ!==hasCorrect)return fail('题量和正确题数需要同时填写或同时留空。');if(hasQ&&(+data.questions<=0||+data.correct<0||+data.correct>+data.questions))return fail('正确题数不能超过题量。');const names=fd.getAll('sectionName'),scores=fd.getAll('sectionScore'),maxes=fd.getAll('sectionMax'),sections=[];for(let i=0;i<names.length;i++){const name=String(names[i]).trim(),sectionScore=String(scores[i]??'').trim(),sectionMax=String(maxes[i]??'').trim();if(!name&&!sectionScore&&!sectionMax)continue;if(!name||sectionScore===''||sectionMax==='')return fail('每个分模块都需要填写名称、得分和满分。');if(+sectionScore<0||+sectionMax<=0||+sectionScore>+sectionMax)return fail(`“${name}”的得分需在 0 到满分之间。`);sections.push({name,score:+sectionScore,maxScore:+sectionMax});}const payload={seriesId:data.seriesId,name:data.name,date:data.date,score,maxScore,durationMinutes,questions:hasQ?+data.questions:0,correct:hasCorrect?+data.correct:0,sections,note:data.note||''};if(id)Object.assign(state.mockRecords.find(r=>r.id===id),payload);else state.mockRecords.push({...payload,id:uid('mockRecord'),createdAt:new Date().toISOString()});mockSeriesFilter=data.seriesId;save();closeForm();render();toast(id?'模考记录已更新。':'模考记录已添加。');return;}
    if(type==='journalNote'){const time=pickedTime(data,'time');if(!data.date||!time||!data.text)return fail('请填写日期、时间和内容。');if(data.date>today())return fail('不能记录未来日期。');const payload={date:data.date,time,text:data.text};if(id)Object.assign(state.journal.notes.find(n=>n.id===id),payload);else state.journal.notes.push({...payload,id:uid('note'),createdAt:new Date().toISOString()});journalDate=data.date;save();closeForm();render();toast('随手记已保存。');return;}
    if(type==='journalEvent'){const time=pickedTime(data,'time');if(!data.date||!time||!data.typeId)return fail('请填写日期、时间和打卡项目。');if(data.date>today())return fail('不能记录未来日期。');const payload={date:data.date,time,typeId:data.typeId};if(id)Object.assign(state.journal.events.find(n=>n.id===id),payload);else state.journal.events.push({...payload,id:uid('event'),createdAt:new Date().toISOString()});journalDate=data.date;save();closeForm();render();toast('生活记录已保存。');return;}
    if(type==='eventType'){if(!data.name)return fail('请填写打卡项目名称。');if(state.journal.eventTypes.some(x=>x.name===data.name&&x.id!==id))return fail('已经存在同名项目。');if(id)state.journal.eventTypes.find(x=>x.id===id).name=data.name;else state.journal.eventTypes.push({id:uid('eventType'),name:data.name,active:true});save();closeForm();render();toast('打卡项目已保存。');return;}
    if(type==='question'){if(!data.text)return fail('请填写问题内容。');let choices=[];if(data.type==='choice'){choices=(data.choices||'').split(/[，,]/).map(x=>x.trim()).filter(Boolean);if(choices.length!==3)return fail('选择题需要正好填写三个选项。');}const weekdays=data.schedule==='weekly'?fd.getAll('weekdays').map(Number):[];if(data.schedule==='weekly'&&!weekdays.length)return fail('请至少选择一个星期。');const payload={text:data.text,type:data.type,choices,schedule:data.schedule,weekdays,active:id?state.journal.questions.find(x=>x.id===id).active!==false:true};if(id)Object.assign(state.journal.questions.find(x=>x.id===id),payload);else state.journal.questions.push({...payload,id:uid('question'),createdAt:new Date().toISOString()});save();closeForm();render();toast('问题已保存。');return;}
    if(type==='answer'){const value=data.value?.trim();if(!value)return fail('请填写回答。');const old=journalAnswer(formCtx.questionId,formCtx.date||journalDate),payload={questionId:formCtx.questionId,date:formCtx.date||journalDate,value,skipped:false};if(old)Object.assign(old,payload);else state.journal.answers.push({...payload,id:uid('answer')});save();closeForm();render();toast('回答已保存。');return;}
    if(type==='review'){const existingTags=fd.getAll('reviewTags').map(x=>String(x).trim()),newTags=(data.newTags||'').split(/[，,]/).map(x=>x.trim()).filter(Boolean),tags=[...new Set([...existingTags,...newTags])];if(!data.subjectId||!data.title||!tags.length)return fail('请选择科目，并填写标题和至少一个错误标签。');const payload={subjectId:data.subjectId,title:data.title,tags,content:data.content,date:id?state.reviews.find(r=>r.id===id).date:today()};if(id)Object.assign(state.reviews.find(r=>r.id===id),payload);else state.reviews.push({...payload,id:uid('review'),createdAt:new Date().toISOString()});save();closeForm();render();toast('复盘已保存。');return;}
  }
  function upsert(key,id,payload,prefix){if(id)Object.assign(state[key].find(x=>x.id===id),payload);else state[key].push({...payload,id:uid(prefix),createdAt:new Date().toISOString()});save();closeForm();render();toast(id?'已更新。':'已添加。');}
  function validateQuestions(d,fail){const q=+d.questions||0,w=+d.wrong||0;if(q<0||w<0){fail('题量和错题数不能为负数。');return false;}if(w>q){fail('错题数不能超过题量。');return false;}return true;}
  function overlaps(start,end,exclude=''){return state.records.some(r=>r.id!==exclude&&(r.segments||[]).some(s=>start<s.end&&end>s.start));}
  function captureForm(){const values={};for(const [key,value] of new FormData($('#entityForm')).entries()){if(values[key]!==undefined)values[key]=Array.isArray(values[key])?[...values[key],value]:[values[key],value];else values[key]=value;}return values;}
  function saveDraft(){if(!formCtx||formCtx.id||!['review','journalNote','answer'].includes(formCtx.type))return;try{localStorage.setItem(DRAFT_KEY,JSON.stringify({type:formCtx.type,questionId:formCtx.questionId||'',values:captureForm()}));}catch(e){}}
  function restoreDraft(){if(!formCtx||formCtx.id||!['review','journalNote','answer'].includes(formCtx.type))return;try{const d=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');if(!d||d.type!==formCtx.type||(d.questionId||'')!==(formCtx.questionId||''))return;restoreForm(d.values);setTimeout(()=>toast('已恢复上次未保存的内容。'),80);}catch(e){}}
  function restoreForm(values={},projectId='',subjectId=''){const selectedSubject=subjectId||values.subjectId||'';if(formCtx?.type==='record'&&selectedSubject){if($('#recordTask'))$('#recordTask').innerHTML=recordTaskSelect(selectedSubject,values.taskId||'');if($('#recordProject'))$('#recordProject').innerHTML=projectSelect(selectedSubject,projectId||values.projectId||'',false);}Object.entries(values).forEach(([name,value])=>{const els=[...document.querySelectorAll(`#entityForm [name="${name}"]`)];els.forEach(el=>{if(el.type==='checkbox')el.checked=(Array.isArray(value)?value:[value]).map(String).includes(el.value);else el.value=value;});});const projectSelectEl=$('[name="projectId"]');if(projectSelectEl&&projectId)projectSelectEl.value=projectId;const subjectSelectEl=$('[name="subjectId"]');if(subjectSelectEl&&subjectId)subjectSelectEl.value=subjectId;}
  function quickProject(){if(!formCtx||!['timerResult','record'].includes(formCtx.type))return;const values=captureForm(),ctx={...formCtx};let subjectId='';if(formCtx.type==='timerResult')subjectId=task(state.timer.taskId)?.subjectId||'';else subjectId=values.subjectId||state.records.find(r=>r.id===formCtx.id)?.subjectId||'';if(!subjectId)return toast('请先选择科目。','error');pendingReturn={ctx,values};closeForm();openForm('project','',{prefillSubjectId:subjectId,returnTo:true});}
  function quickSubject(returnType=''){if(formCtx&&formCtx.type!=='subject'){if(formCtx.type==='project'&&formCtx.returnTo)return toast('从任务新增项目时，项目必须使用任务所属科目。','error');pendingSubjectReturn={ctx:{...formCtx},values:captureForm()};closeForm();openForm('subject','',{returnToForm:true});return;}if(returnType){pendingSubjectReturn={ctx:{type:returnType,id:''},values:{}};openForm('subject','',{returnToForm:true});return;}openForm('subject');}
  function closeForm(){$('#formDialog').close();formCtx=null;}
  function cancelForm(){if(formCtx?.type==='subject'&&formCtx.returnToForm&&pendingSubjectReturn){const back=pendingSubjectReturn;pendingSubjectReturn=null;closeForm();if(back.ctx.type==='project'&&!state.subjects.length)return;openForm(back.ctx.type,back.ctx.id,back.ctx);restoreForm(back.values);return;}if(formCtx?.type==='project'&&formCtx.returnTo&&pendingReturn){const back=pendingReturn;pendingReturn=null;closeForm();openForm(back.ctx.type,back.ctx.id,back.ctx);restoreForm(back.values);return;}closeForm();}

  function startTimer(id,date){if(state.timer.status!=='idle'){if(state.timer.taskId===id){updateTimer();return;}return toast('已有任务正在计时，请先处理当前计时。','error');}state.timer={status:'running',taskId:id,taskDate:date,segments:[],currentStart:Date.now()};save();updateTimer();toast('计时已开始。');}
  function toggleTimer(){if(state.timer.status==='running'){state.timer.segments.push({start:state.timer.currentStart,end:Date.now()});state.timer.currentStart=null;state.timer.status='paused';}else if(state.timer.status==='paused'){state.timer.currentStart=Date.now();state.timer.status='running';}save();updateTimer();}
  function finishTimer(){if(state.timer.status==='running'){state.timer.segments.push({start:state.timer.currentStart,end:Date.now()});state.timer.currentStart=null;state.timer.status='paused';save();}if(timerElapsed()<1000)return toast('计时时间太短，暂时无法保存。','error');updateTimer();openForm('timerResult');}
  function updateTimer(){const bar=$('#miniTimer');bar.classList.toggle('hidden',state.timer.status==='idle');if(state.timer.status==='idle')return;const t=task(state.timer.taskId),s=t&&subject(t.subjectId);$('#timerTask').textContent=t?.title||'任务已不存在';$('#timerSubject').textContent=s?.name||'';$('#timerClock').textContent=clock(timerElapsed());$('#timerToggle').textContent=state.timer.status==='running'?'暂停':'继续';}

  function openCountdownDetail(id){const c=state.countdowns.find(x=>x.id===id);if(!c)return;$('#detailContent').innerHTML=`<div class="sheet-head"><div><small>COUNTDOWN</small><h2>${esc(c.name)}</h2></div><button class="icon-btn" data-detail-close>×</button></div><p class="muted">${fmtFullDate(c.date)}${c.note?` · ${esc(c.note)}`:''}</p><div class="section-title" style="margin-top:25px"><h2>阶段</h2><button class="text-btn" data-add-stage="${c.id}">＋ 增加</button></div><div class="settings-list">${(c.stages||[]).length?(c.stages||[]).sort((a,b)=>a.start.localeCompare(b.start)).map(s=>`<div class="settings-row"><button data-edit-stage="${s.id}" data-countdown-id="${c.id}"><b>${esc(s.name)}</b><br><small>${fmtFullDate(s.start)}—${fmtFullDate(s.end)} · ${s.start<=today()&&s.end>=today()?'进行中':s.end<today()?'已结束':'未开始'}</small></button><button class="icon-btn" data-delete-stage="${s.id}" data-countdown-id="${c.id}" aria-label="删除阶段">×</button></div>`).join(''):'<p class="muted">还没有设置阶段</p>'}</div>`;$('#detailDialog').showModal();}
  function openRecordDetail(id){const r=state.records.find(x=>x.id===id);if(!r)return;const s=recordSubject(r),p=project(r.projectId);$('#detailContent').innerHTML=`<div class="detail-head"><div><small>${fmtFullDate(r.date)}</small><h2>${esc(recordTitle(r))}</h2></div><button class="icon-btn" data-detail-close>×</button></div><div class="detail-grid"><div class="detail-item"><span>科目</span><b>${esc(s.name||'—')}</b></div><div class="detail-item"><span>总时长</span><b>${fmtDuration(recordDuration(r))}</b></div><div class="detail-item"><span>学习项目</span><b>${esc(p?.name||'未关联')}</b></div><div class="detail-item"><span>完成数量</span><b>${r.units||'—'} ${p?.unit||''}</b></div><div class="detail-item"><span>题量</span><b>${r.questions||'—'}</b></div><div class="detail-item"><span>正确率</span><b>${r.questions?`${Math.round((r.questions-r.wrong)/r.questions*1000)/10}%`:'—'}</b></div></div><div class="detail-actions"><button class="secondary" data-edit-record="${r.id}">编辑</button><button class="danger" data-delete-record="${r.id}">删除</button></div>`;$('#detailDialog').showModal();}
  function openMockRecord(id){const r=state.mockRecords.find(x=>x.id===id);if(!r)return;const series=state.mockSeries.find(x=>x.id===r.seriesId);$('#detailContent').innerHTML=`<div class="detail-head"><div><small>${fmtFullDate(r.date)} · ${esc(series?.name||'模考')}</small><h2>${esc(r.name)}</h2></div><button class="icon-btn" data-detail-close>×</button></div><div class="detail-grid"><div class="detail-item"><span>成绩</span><b>${r.score}/${r.maxScore}</b></div><div class="detail-item"><span>得分率</span><b>${mockPct(r)}%</b></div><div class="detail-item"><span>用时</span><b>${fmtDuration(r.durationMinutes*60000)}</b></div><div class="detail-item"><span>正确率</span><b>${r.questions?`${Math.round(r.correct/r.questions*1000)/10}%`:'—'}</b></div></div>${r.sections?.length?`<div class="settings-list">${r.sections.map(x=>`<div class="settings-row"><b>${esc(x.name)}</b><span>${x.score}/${x.maxScore}</span></div>`).join('')}</div>`:''}${r.note?`<p style="white-space:pre-wrap;line-height:1.7">${esc(r.note)}</p>`:''}<div class="detail-actions"><button class="secondary" data-edit-mock-record="${r.id}">编辑</button><button class="danger" data-delete-mock-record="${r.id}">删除</button></div>`;$('#detailDialog').showModal();}
  function openTaskMenu(id,date){const t=task(id);$('#detailContent').innerHTML=`<div class="sheet-head"><div><small>TASK</small><h2>${esc(t.title)}</h2></div><button class="icon-btn" data-detail-close>×</button></div><div class="settings-list"><button data-edit-task="${id}">编辑任务</button><button data-delete-task="${id}" class="danger-text">删除今天及未来</button></div><p class="help">过去已经形成的完成和未完成记录会保留。</p>`;$('#detailDialog').showModal();}
  function openProjectMenu(id){const p=project(id),totals=projectTotals(id),autoEnded=totals.units>=p.total;$('#detailContent').innerHTML=`<div class="sheet-head"><div><small>PROJECT</small><h2>${esc(p.name)}</h2></div><button class="icon-btn" data-detail-close>×</button></div><div class="settings-list"><button data-edit-project="${id}">编辑项目</button>${autoEnded?'<p class="help">项目已达到总数量。如需继续，请编辑并增加总数量。</p>':`<button data-toggle-project="${id}">${p.manualEnded?'重新启用':'结束项目'}</button>`}<button data-delete-project="${id}" class="danger-text">删除项目</button></div>`;$('#detailDialog').showModal();}
  function openReviewMenu(id){const r=state.reviews.find(x=>x.id===id);$('#detailContent').innerHTML=`<div class="sheet-head"><div><small>${fmtFullDate(r.date)}</small><h2>${esc(r.title)}</h2></div><button class="icon-btn" data-detail-close>×</button></div><div class="review-tags">${r.tags.map(t=>`<span>#${esc(t)}</span>`).join('')}</div><p style="white-space:pre-wrap;line-height:1.7">${esc(r.content||'')}</p><div class="detail-actions"><button class="secondary" data-edit-review="${id}">编辑</button><button class="danger" data-delete-review="${id}">删除</button></div>`;$('#detailDialog').showModal();}
  function openJournalEventMenu(id){const x=state.journal.events.find(e=>e.id===id);if(!x)return;$('#detailContent').innerHTML=`<div class="sheet-head"><div><small>${fmtFullDate(x.date)} · ${x.time}</small><h2>${esc(eventType(x.typeId)?.name||'生活记录')}</h2></div><button class="icon-btn" data-detail-close>×</button></div><div class="detail-actions"><button class="secondary" data-edit-journal-event="${id}">编辑</button><button class="danger" data-delete-journal-event="${id}">删除</button></div>`;$('#detailDialog').showModal();}
  function openNoteMenu(id){const x=state.journal.notes.find(n=>n.id===id);if(!x)return;$('#detailContent').innerHTML=`<div class="sheet-head"><div><small>${fmtFullDate(x.date)} · ${x.time}</small><h2>随手记</h2></div><button class="icon-btn" data-detail-close>×</button></div><p style="white-space:pre-wrap;line-height:1.7">${esc(x.text)}</p><div class="detail-actions"><button class="secondary" data-edit-note="${id}">编辑</button><button class="danger" data-delete-note="${id}">删除</button></div>`;$('#detailDialog').showModal();}
  function manageSubjects(){const used=id=>state.tasks.some(t=>t.subjectId===id)||state.projects.some(p=>p.subjectId===id)||state.records.some(r=>r.subjectId===id)||state.reviews.some(r=>r.subjectId===id);$('#detailContent').innerHTML=`<div class="sheet-head"><div><small>SUBJECTS</small><h2>科目管理</h2></div><button class="icon-btn" data-detail-close>×</button></div><button class="primary full" data-add-subject>＋ 新增科目</button><div class="settings-list">${state.subjects.map(s=>`<div class="settings-row"><button data-edit-subject="${s.id}"><i class="dot" style="background:${s.color}"></i> <b>${esc(s.name)}</b>${used(s.id)?'<small> · 已有数据</small>':''}</button>${used(s.id)?'':`<button class="icon-btn" data-delete-subject="${s.id}" aria-label="删除科目">×</button>`}</div>`).join('')||'<p class="muted">还没有科目</p>'}</div>`;$('#detailDialog').showModal();}
  function openSettings(){
    const email=currentUser&&currentUser.email?esc(currentUser.email):'未登录';
    const backupButton=localStorage.getItem(UNLINKED_BACKUP_KEY)?'<button data-action="export-unlinked-backup">导出未关联账号的本机备份</button>':'';
    $('#detailContent').innerHTML='<div class="sheet-head"><div><small>ACCOUNT & SETTINGS</small><h2>账号与数据</h2></div><button class="icon-btn" data-detail-close>×</button></div>'+
      '<p class="muted">当前账号：'+email+'</p>'+
      '<p class="muted" id="syncStatusDetail">正在检查同步状态…</p>'+
      '<div class="settings-list"><button data-action="export">导出 JSON 备份</button><button data-action="import">导入 JSON 备份</button>'+backupButton+'<button data-action="account-signout" class="danger-text">退出登录</button><button data-action="clear-all" class="danger-text">清空全部数据</button></div>'+
      '<p class="muted">清空数据会同步到云端，并影响此账号的学习记录；操作前请先导出备份。</p>';
    $('#detailDialog').showModal();
    setSyncStatus(cloudReady?'云端已连接':currentUser?'正在连接云端':'未登录',false);
  }

  function ask(title,text,fn,label='确认'){confirmCallback=fn;$('#confirmTitle').textContent=title;$('#confirmText').textContent=text;$('#confirmOk').textContent=label;$('#confirmDialog').showModal();}
  function toast(msg,type='') {const x=document.createElement('div');x.className=`toast ${type}`;x.textContent=msg;$('#toasts').append(x);setTimeout(()=>x.remove(),3000);}
  function deleteTask(id){const t=task(id);if(t.startDate<today()||Object.keys(state.taskStates).some(k=>k.startsWith(`${id}|`))||state.records.some(r=>r.taskId===id)){t.endDate=addDays(today(),-1);}else state.tasks=state.tasks.filter(x=>x.id!==id);save();render();toast('今天和未来的任务已删除，历史记录已保留。');}
  function deleteProject(id){if(state.records.some(r=>r.projectId===id))return toast('该项目已有学习数据，不能删除，可以结束项目。','error');state.projects=state.projects.filter(p=>p.id!==id);save();render();toast('项目已删除。');}
  function exportData(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`StudyFlow-${today()}.json`;a.click();URL.revokeObjectURL(a.href);toast('备份文件已导出。');}

  document.addEventListener('click',e=>{
    const authModeButton=e.target.closest('[data-auth-mode]');
    if(authModeButton){setAuthMode(authModeButton.dataset.authMode);return;}
    const nav=e.target.closest('[data-nav]')?.dataset.nav;if(nav)go(nav);
    const action=e.target.closest('[data-action]')?.dataset.action;if(action){if(action==='add-countdown')openForm('countdown');if(action==='add-task'){if(!state.subjects.length)return quickSubject('task');openForm('task');}if(action==='add-project'){if(!state.subjects.length)return quickSubject('project');openForm('project');}if(action==='add-record'){if(!state.subjects.length)return quickSubject('record');recordDate=view==='journal'?journalDate:(statsMode==='day'?statsAnchor:today());openForm('record');}if(action==='add-review'){if(!state.subjects.length)return quickSubject('review');openForm('review');}if(action==='add-mock-series')openForm('mockSeries');if(action==='add-mock-record'){if(!state.mockSeries.length)return openForm('mockSeries');openForm('mockRecord','',{seriesId:mockSeriesFilter});}if(action==='manage-subjects')manageSubjects();if(action==='quick-subject')quickSubject();if(action==='quick-project')quickProject();if(action==='settings'||action==='account')openSettings();if(action==='account-signout')signOutUser();if(action==='export-unlinked-backup')exportUnlinkedBackup();if(action==='stats-today'){statsAnchor=today();renderStats();}if(action==='show-today-stats'){statsMode='day';statsAnchor=today();go('stats');}if(action==='show-overdue'){taskState='overdue';go('tasks');}if(action==='timer-focus')go('home');if(action==='timer-finish')finishTimer();if(action==='export')exportData();if(action==='import')$('#backupInput').click();if(action==='clear-all')ask('清空全部数据？','所有任务、项目、记录和复盘都会被删除，且无法撤销。',()=>{state=blank();save();$('#detailDialog').close();render();toast('全部数据已清空。');},'清空');}
    if(action==='add-subject')openForm('subject');if(action==='add-note')openForm('journalNote','',{date:journalDate});if(action==='add-event-type')openForm('eventType');if(action==='add-question')openForm('question');if(action==='journal-today'){journalDate=today();renderJournal();}
    const tm=e.target.closest('[data-task-main]')?.dataset.taskMain;if(tm){taskMain=tm;renderTasks();}const ts=e.target.closest('[data-task-state]')?.dataset.taskState;if(ts){taskState=ts;renderTasks();}const ps=e.target.closest('[data-project-state]')?.dataset.projectState;if(ps){projectState=ps;renderTasks();}const sf=e.target.closest('[data-subject-filter]');if(sf){subjectFilter=sf.dataset.subjectFilter;renderTasks();}const mf=e.target.closest('[data-mock-series-filter]');if(mf){mockSeriesFilter=mf.dataset.mockSeriesFilter;renderTasks();}
    const rv=e.target.closest('[data-review-view]')?.dataset.reviewView;if(rv){reviewView=rv;renderReviews();}const am=e.target.closest('[data-archive-mode]')?.dataset.archiveMode;if(am){reviewArchiveMode=am;renderReviews();}const rf=e.target.closest('[data-review-folder]');if(rf){reviewView='recent';reviewLimit=20;if(rf.dataset.reviewFolder==='subject'){reviewSubject=rf.dataset.folderValue;reviewMonth='';}else{reviewMonth=rf.dataset.folderValue;reviewSubject='';}renderReviews();}if(e.target.closest('#reviewMore')){reviewLimit+=20;renderReviews();}
    const jv=e.target.closest('[data-journal-view]')?.dataset.journalView;if(jv){journalView=jv;renderJournal();}const js=e.target.closest('[data-journal-shift]');if(js){journalDate=addDays(journalDate,+js.dataset.journalShift);renderJournal();}const jd=e.target.closest('[data-open-journal-day]');if(jd){journalDate=jd.dataset.openJournalDay;journalView='today';renderJournal();}
    const jf=e.target.closest('[data-journal-field]');if(jf){const key=jf.dataset.journalField,value=jf.dataset.journalValue,d=journalDay(journalDate);if(jf.dataset.multi==='true'){const values=[...(d[key]||[])],i=values.indexOf(value);if(i>=0)values.splice(i,1);else if(values.length<3)values.push(value);else return toast('状态最多选择3个。','error');updateJournalDay(journalDate,{[key]:values});}else updateJournalDay(journalDate,{[key]:d[key]===value?'':value});}
    const qe=e.target.closest('[data-quick-event]');if(qe){if(journalDate>today())return toast('不能记录未来日期。','error');const now=new Date(),time=`${pad(now.getHours())}:${pad(now.getMinutes())}`;state.journal.events.push({id:uid('event'),date:journalDate,time,typeId:qe.dataset.quickEvent,createdAt:new Date().toISOString()});save();render();toast(`${eventType(qe.dataset.quickEvent)?.name||'事件'}已记录。`);}
    const qc=e.target.closest('[data-question-choice]');if(qc){const old=journalAnswer(qc.dataset.questionChoice,journalDate),payload={questionId:qc.dataset.questionChoice,date:journalDate,value:qc.dataset.choice,skipped:false};if(old)Object.assign(old,payload);else state.journal.answers.push({...payload,id:uid('answer')});save();renderJournal();}const sq=e.target.closest('[data-skip-question]');if(sq){const old=journalAnswer(sq.dataset.skipQuestion,journalDate);if(old){old.skipped=!old.skipped;if(old.skipped)old.value='';}else state.journal.answers.push({id:uid('answer'),questionId:sq.dataset.skipQuestion,date:journalDate,value:'',skipped:true});save();renderJournal();}const aq=e.target.closest('[data-answer-question]');if(aq)openForm('answer','',{questionId:aq.dataset.answerQuestion,date:journalDate});
    const jem=e.target.closest('[data-journal-event-menu]');if(jem)openJournalEventMenu(jem.dataset.journalEventMenu);const nm=e.target.closest('[data-note-menu]');if(nm)openNoteMenu(nm.dataset.noteMenu);
    const toggle=e.target.closest('[data-toggle-task]');if(toggle){const k=taskStateKey(toggle.dataset.toggleTask,toggle.dataset.taskDate),old=state.taskStates[k]?.completed;state.taskStates[k]={completed:!old,completedAt:!old?new Date().toISOString():''};save();render();toast(!old?'任务已完成。':'任务已恢复为未完成。');}
    const start=e.target.closest('[data-start-timer]');if(start)startTimer(start.dataset.startTimer,start.dataset.taskDate);
    const menu=e.target.closest('[data-task-menu]');if(menu)openTaskMenu(menu.dataset.taskMenu,menu.dataset.taskDate);const pm=e.target.closest('[data-project-menu]');if(pm)openProjectMenu(pm.dataset.projectMenu);const rm=e.target.closest('[data-review-menu]');if(rm)openReviewMenu(rm.dataset.reviewMenu);
    const ec=e.target.closest('[data-edit-countdown]');if(ec)openForm('countdown',ec.dataset.editCountdown);const dc=e.target.closest('[data-delete-countdown]');if(dc)ask('删除倒计时？','该倒计时和它的全部阶段会被删除，不影响任务与学习记录。',()=>{state.countdowns=state.countdowns.filter(c=>c.id!==dc.dataset.deleteCountdown);save();render();toast('倒计时已删除。');},'删除');const ms=e.target.closest('[data-manage-stages]');if(ms)openCountdownDetail(ms.dataset.manageStages);const as=e.target.closest('[data-add-stage]');if(as){$('#detailDialog').close();openForm('stage','',{countdownId:as.dataset.addStage});}const es=e.target.closest('[data-edit-stage]');if(es){$('#detailDialog').close();openForm('stage',es.dataset.editStage,{countdownId:es.dataset.countdownId});}const dstg=e.target.closest('[data-delete-stage]');if(dstg){const countdownId=dstg.dataset.countdownId;$('#detailDialog').close();ask('删除阶段？','只会删除这个阶段，不影响倒计时和其他数据。',()=>{const c=state.countdowns.find(x=>x.id===countdownId);if(c)c.stages=(c.stages||[]).filter(s=>s.id!==dstg.dataset.deleteStage);save();render();toast('阶段已删除。');},'删除');}
    if(e.target.closest('[data-add-subject]')){$('#detailDialog').close();openForm('subject');}const esu=e.target.closest('[data-edit-subject]');if(esu){$('#detailDialog').close();openForm('subject',esu.dataset.editSubject);}const dsbj=e.target.closest('[data-delete-subject]');if(dsbj){$('#detailDialog').close();ask('删除科目？','这个科目还没有关联数据，可以安全删除。',()=>{state.subjects=state.subjects.filter(s=>s.id!==dsbj.dataset.deleteSubject);save();render();toast('科目已删除。');},'删除');}
    const et=e.target.closest('[data-edit-task]');if(et){$('#detailDialog').close();openForm('task',et.dataset.editTask);}const dt=e.target.closest('[data-delete-task]');if(dt){$('#detailDialog').close();ask('删除任务？','今天和未来不再出现，过去的完成与未完成记录会保留。',()=>deleteTask(dt.dataset.deleteTask),'删除');}
    const ep=e.target.closest('[data-edit-project]');if(ep){$('#detailDialog').close();openForm('project',ep.dataset.editProject);}const tp=e.target.closest('[data-toggle-project]');if(tp){const p=project(tp.dataset.toggleProject);p.manualEnded=!p.manualEnded;save();$('#detailDialog').close();render();toast(p.manualEnded?'项目已结束。':'项目已重新启用。');}const dp=e.target.closest('[data-delete-project]');if(dp){$('#detailDialog').close();ask('删除项目？','只有没有学习数据的项目可以删除。',()=>deleteProject(dp.dataset.deleteProject),'删除');}
    const rd=e.target.closest('[data-record-detail]');if(rd)openRecordDetail(rd.dataset.recordDetail);const er=e.target.closest('[data-edit-record]');if(er){$('#detailDialog').close();openForm('record',er.dataset.editRecord);}const dr=e.target.closest('[data-delete-record]');if(dr){$('#detailDialog').close();ask('删除学习记录？','学习时长、项目进度和做题统计会重新计算，任务状态不变。',()=>{state.records=state.records.filter(r=>r.id!==dr.dataset.deleteRecord);save();render();toast('记录已删除。');},'删除');}
    const mr=e.target.closest('[data-mock-record]');if(mr)openMockRecord(mr.dataset.mockRecord);const emr=e.target.closest('[data-edit-mock-record]');if(emr){$('#detailDialog').close();openForm('mockRecord',emr.dataset.editMockRecord);}const dmr=e.target.closest('[data-delete-mock-record]');if(dmr){$('#detailDialog').close();ask('删除模考记录？','这条成绩及其趋势数据会被删除。',()=>{state.mockRecords=state.mockRecords.filter(r=>r.id!==dmr.dataset.deleteMockRecord);save();render();toast('模考记录已删除。');},'删除');}const ems=e.target.closest('[data-edit-mock-series]');if(ems)openForm('mockSeries',ems.dataset.editMockSeries);const dms=e.target.closest('[data-delete-mock-series]');if(dms){if(state.mockRecords.some(r=>r.seriesId===dms.dataset.deleteMockSeries))toast('该系列已有模考记录，请先删除其中的记录。','error');else ask('删除模考系列？','这个空系列会被删除。',()=>{state.mockSeries=state.mockSeries.filter(s=>s.id!==dms.dataset.deleteMockSeries);mockSeriesFilter='';save();render();toast('模考系列已删除。');},'删除');}
    const eje=e.target.closest('[data-edit-journal-event]');if(eje){$('#detailDialog').close();openForm('journalEvent',eje.dataset.editJournalEvent);}const dje=e.target.closest('[data-delete-journal-event]');if(dje){$('#detailDialog').close();ask('删除生活记录？','这条打卡会从当天时间轴中移除。',()=>{state.journal.events=state.journal.events.filter(x=>x.id!==dje.dataset.deleteJournalEvent);save();render();toast('生活记录已删除。');},'删除');}const en=e.target.closest('[data-edit-note]');if(en){$('#detailDialog').close();openForm('journalNote',en.dataset.editNote);}const dn=e.target.closest('[data-delete-note]');if(dn){$('#detailDialog').close();ask('删除随手记？','这条内容会从当天日记中移除。',()=>{state.journal.notes=state.journal.notes.filter(x=>x.id!==dn.dataset.deleteNote);save();render();toast('随手记已删除。');},'删除');}
    const eet=e.target.closest('[data-edit-event-type]');if(eet)openForm('eventType',eet.dataset.editEventType);const tet=e.target.closest('[data-toggle-event-type]');if(tet){const x=eventType(tet.dataset.toggleEventType);x.active=x.active===false;save();renderJournal();}const eq=e.target.closest('[data-edit-question]');if(eq)openForm('question',eq.dataset.editQuestion);const tq=e.target.closest('[data-toggle-question]');if(tq){const x=state.journal.questions.find(q=>q.id===tq.dataset.toggleQuestion);x.active=x.active===false;save();renderJournal();}
    const rev=e.target.closest('[data-edit-review]');if(rev){$('#detailDialog').close();openForm('review',rev.dataset.editReview);}const drv=e.target.closest('[data-delete-review]');if(drv){$('#detailDialog').close();ask('删除复盘？','这条复盘和相关标签统计会被删除。',()=>{state.reviews=state.reviews.filter(r=>r.id!==drv.dataset.deleteReview);save();render();toast('复盘已删除。');},'删除');}
    const rt=e.target.closest('[data-review-tag]');if(rt){reviewTag=rt.dataset.reviewTag;reviewSubject='';reviewMonth='';reviewView='recent';renderReviews();}
    const ss=e.target.closest('[data-stats-shift]');if(ss){const n=+ss.dataset.statsShift;statsAnchor=statsMode==='day'?addDays(statsAnchor,n):statsMode==='week'?addDays(statsAnchor,n*7):dateKey(new Date(parseDate(statsAnchor).getFullYear(),parseDate(statsAnchor).getMonth()+n,1,12));renderStats();}
    const sm=e.target.closest('[data-stats-mode]')?.dataset.statsMode;if(sm){statsMode=sm;renderStats();}const od=e.target.closest('[data-open-day]');if(od){statsMode='day';statsAnchor=od.dataset.openDay;renderStats();}
    if(e.target.closest('[data-detail-close]'))$('#detailDialog').close();if(e.target.closest('[data-close]'))cancelForm();
  });
  $('#entityForm').addEventListener('submit',e=>{submitForm(e);setTimeout(()=>{if(!$('#formDialog').open)localStorage.removeItem(DRAFT_KEY);},0);});$('#entityForm').addEventListener('input',saveDraft);$('#timerToggle').addEventListener('click',toggleTimer);$('#taskPageAdd').addEventListener('click',()=>{if(taskMain==='tasks'){if(!state.subjects.length)return openForm('subject');openForm('task');}else if(taskMain==='projects'){if(!state.subjects.length)return openForm('subject');openForm('project');}else if(taskMain==='subjects')openForm('subject');else if(!state.mockSeries.length)openForm('mockSeries');else openForm('mockRecord','',{seriesId:mockSeriesFilter});});
  $('#formFields').addEventListener('change',e=>{if(e.target.name==='repeat'){const r=e.target.value;$('#weeklyFields')?.classList.toggle('hidden',r!=='weekly');$('#repeatEnd')?.classList.toggle('hidden',r==='none');const lab=$('[name="startDate"]')?.closest('.field')?.querySelector('span');if(lab)lab.textContent=r==='none'?'任务日期 *':'开始日期 *';}if(e.target.name==='unit')$('#customUnit')?.classList.toggle('hidden',e.target.value!=='custom');if(e.target.name==='subjectId'&&formCtx?.type==='record'){if($('#recordTask'))$('#recordTask').innerHTML=recordTaskSelect(e.target.value,'');if($('#recordProject'))$('#recordProject').innerHTML=projectSelect(e.target.value,'',false);}if(e.target.name==='type'&&formCtx?.type==='question')$('#questionChoices')?.classList.toggle('hidden',e.target.value!=='choice');if(e.target.name==='schedule'&&formCtx?.type==='question')$('#questionWeekdays')?.classList.toggle('hidden',e.target.value!=='weekly');});
  $('#formFields').addEventListener('click',e=>{if(e.target.closest('[data-add-mock-section]'))$('#mockSections')?.insertAdjacentHTML('beforeend',mockSectionRow());const remove=e.target.closest('[data-remove-mock-section]');if(remove)remove.closest('.mock-section-row')?.remove();});
  $('#reviewSubjectFilter').addEventListener('change',e=>{reviewSubject=e.target.value;reviewMonth='';reviewLimit=20;renderReviews();});$('#reviewTagFilter').addEventListener('change',e=>{reviewTag=e.target.value;reviewLimit=20;renderReviews();});$('#reviewSearch').addEventListener('input',e=>{reviewSearch=e.target.value.trim();reviewLimit=20;renderReviews();});
  $('#journalTodayContent').addEventListener('change',e=>{const questionId=e.target.dataset.questionAnswer;if(questionId){const value=e.target.value.trim(),old=journalAnswer(questionId,journalDate),payload={questionId,date:journalDate,value,skipped:false};if(old)Object.assign(old,payload);else state.journal.answers.push({...payload,id:uid('answer')});save();toast('回答已自动保存。');return;}const key=e.target.dataset.journalInput;if(!key)return;let value=e.target.value;if(key==='keywords')value=value.split(/[，,]/).map(x=>x.trim()).filter(Boolean).slice(0,3).join('，');if(key==='sleepHours')value=Math.max(0,Math.min(24,+value||0));if(key==='sleepMinutes')value=Math.max(0,Math.min(59,+value||0));updateJournalDay(journalDate,{[key]:value});});
  $('#confirmDialog').addEventListener('close',()=>{if($('#confirmDialog').returnValue==='ok'&&confirmCallback)confirmCallback();confirmCallback=null;});
  $('#backupInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{const x=JSON.parse(await f.text());if(!x||!Array.isArray(x.tasks)||!Array.isArray(x.records))throw Error();localStorage.setItem(KEY,JSON.stringify(x));state=load();save();$('#detailDialog').close();render();toast('备份已导入。');}catch(err){toast('备份文件无法读取。','error');}e.target.value='';});
  window.addEventListener('storage',e=>{if(e.key===KEY){state=load();render();toast('数据已从另一个页面同步。');}});document.addEventListener('visibilitychange',()=>{if(!document.hidden){updateTimer();syncFromCloud();}});
  tick=setInterval(()=>{if(state.timer.status==='running')updateTimer();},1000);
  render();if(state.timer.status!=='idle')toast(state.timer.status==='running'?'已恢复运行中的计时。':'已恢复暂停中的计时。');
  initAuth();
})();
