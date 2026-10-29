(function(){
if(location.protocol==='file:')return;
const initialActivation=BonoAuth.activationContext(location);
const initialHash=new URLSearchParams(location.hash.slice(1));
let passwordRecoveryMode=initialHash.get('type')==='recovery'&&!!initialHash.get('access_token')&&!!initialHash.get('refresh_token')&&!initialHash.has('error');
const SUPABASE_URL = 'https://vhdygrooeipxibnpofxf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_I4uK-zm16tOepB_N2TzXqg_WlVd22QB';
const client = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = (selector) => document.querySelector(selector);
const loginView = $('#login-view');
const appView = $('#app-view');
const landingView = $('#landing-view');
let watches = [];
let events = [];
let notes = [];
let tasks = [];
let documents = [];
let currentWatchId = null;
let currentOrganization = null;
let currentMembership = null;
let consents = [];
let privacyRequests = [];
let auditEvents = [];
let verifiedClientCase = null;
let caseProfiles = [];
let caseFeaturesAvailable = false;
let isPlatformAdmin = false;
let sessionOrganizations = [];
let sessionMemberships = [];
let sessionUser = null;
let currentAdminView = 'summary';
let loadSequence = 0;
let activationHandled = false;
let activationVerificationAccepted = false;
let passwordOwner = null;
const authParams = new URLSearchParams(location.search);
let activationMode = authParams.get('activar')==='1';
const profileFor = watch => caseProfiles.find(p=>p.watch_id===watch.id);
const canEditCases = () => ['owner','admin','agent'].includes(currentMembership?.role);
const caseManager = BonoManagement.mount({container:'#integral-case-management',client,getContext:()=>({organization:currentOrganization,membership:currentMembership}),onSaved:async()=>{await loadData();const watch=watches.find(w=>w.id===currentWatchId);if(watch)$('#internal-deadline').innerHTML=formalizationHtml(watch);},toast});
const operationsReports = BonoReports.mount({container:'#operations-reports',getData:()=>({watches,profiles:caseProfiles,events,documents,tasks}),onOpen:id=>openDetail(id),canExport:()=>['owner','admin'].includes(currentMembership?.role),toast});
const platformManager = BonoPlatform.mount({container:'#platform-admin',client,getContext:()=>({isPlatformAdmin,currentOrganization}),onChanged:async()=>{if(sessionUser)await showSession({user:sessionUser});},toast});

function trafficStatus(watch){
  if(watch.last_error)return 'red';
  if(watch.due_at){const hours=(new Date(watch.due_at)-Date.now())/36e5;if(hours<0)return 'red';if(hours<72)return 'yellow';}
  if(watch.last_success_at&&(Date.now()-new Date(watch.last_success_at))/864e5>3)return 'yellow';
  return 'green';
}
function formalizationInfo(watch){return BonoCase.formalizationInfo(watch,profileFor(watch)||{});}
function formalizationHtml(watch){const info=formalizationInfo(watch);if(!info)return'';if(info.completed)return'<span class="deadline-alert">Formalización completada · Recordatorios detenidos</span>';const deadline=new Intl.DateTimeFormat('es-CR',{dateStyle:'long',timeZone:'UTC'}).format(new Date(info.date+'T12:00:00Z'));return`<span class="deadline-alert ${info.days<=10?'urgent':''}"><strong>Meta interna de formalización</strong><small>${info.elapsed} de ${info.totalDays} días desde EMITIDO · ${info.days<0?`${Math.abs(info.days)} días después de la meta`:`Faltan ${info.days} días`} · ${escapeHtml(deadline)}</small></span>`;}
function formalizationRowHtml(watch){const info=formalizationInfo(watch);if(!info)return'';if(info.completed)return'<span class="row-deadline">Formalización completada</span>';return`<span class="row-deadline ${info.days<=10?'urgent':''}"><strong>${info.elapsed} días desde EMITIDO</strong> · Meta ${info.totalDays} días · ${info.days<0?`excedida ${Math.abs(info.days)} días`:`faltan ${info.days} días`}</span>`;}

function formatDate(value) {
  if (!value) return 'Aún no revisado';
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Costa_Rica' }).format(new Date(value));
}
function escapeHtml(value='') { const div=document.createElement('div'); div.textContent=String(value); return div.innerHTML; }
function latestState(states) {
  if (!Array.isArray(states) || !states.length) return 'Pendiente de primera revisión';
  return [...states].sort((a,b) => { const [da,ma,ya]=a.date.split('/').map(Number),[db,mb,yb]=b.date.split('/').map(Number); return new Date(yb,mb-1,db)-new Date(ya,ma-1,da); })[0].description;
}
function toast(text){ const el=$('#toast'); el.textContent=text; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2600); }

async function signIn(event) {
  event.preventDefault();
  if(activationMode){await requestMagicLink(true);return;}
  const email = $('#email').value.trim().toLowerCase();
  const password = $('#password').value;
  const message = $('#login-message');
  message.textContent='Verificando acceso…'; message.className='message';
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) { message.textContent=BonoAuth.describeError(error,{action:'password'}); message.className='message error'; return; }
  message.textContent='Acceso correcto.';
}

function loginEmail(){return $('#email').value.trim().toLowerCase();}
function redirectUrl(activate=false){return BonoAuth.redirectUrl(location,{activate,organizationSlug:authParams.get('empresa')});}
async function requestPasswordReset(){
  const email=loginEmail(),message=$('#login-message');
  if(!email){message.textContent='Primero escribí tu correo autorizado.';message.className='message error';$('#email').focus();return;}
  message.textContent='Enviando instrucciones…';message.className='message';
  const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:redirectUrl()});
  if(error){message.textContent=BonoAuth.describeError(error);message.className='message error';return;}
  message.textContent='Si la cuenta ya existe, recibirás un enlace para cambiar tu contraseña. Para una cuenta nueva, usá “Activar acceso por primera vez”.';
}
async function requestMagicLink(activate=false){
  const email=loginEmail(),message=$('#login-message');
  if(!email){message.textContent='Primero escribí tu correo autorizado.';message.className='message error';$('#email').focus();return;}
  message.textContent='Enviando enlace seguro…';message.className='message';
  if(activate){
    activationMode=true;activationHandled=false;activationVerificationAccepted=false;passwordOwner=null;renderAuthMode();
    sessionStorage.setItem('bonoalerta-activation',email);
    const {error:signOutError}=await client.auth.signOut({scope:'local'});
    if(signOutError){message.textContent='No se pudo cerrar la sesión anterior. Abrí el enlace de activación en una ventana privada.';message.className='message error';return;}
  }
  const {error}=await client.auth.signInWithOtp({email,options:{emailRedirectTo:redirectUrl(activate),shouldCreateUser:activate}});
  if(error){message.textContent=BonoAuth.describeError(error);message.className='message error';return;}
  message.textContent=activate?'Revisá tu correo para verificar la cuenta. El acceso a la empresa depende de la asignación del superadministrador.':'Revisá tu correo y abrí el enlace de acceso.';
}
function openPasswordDialog(session,reason){
  if(!session?.user?.id||!session.user.email)return;
  passwordOwner={id:session.user.id,email:session.user.email.toLowerCase()};
  $('#password-identity').textContent=`La contraseña se guardará para: ${passwordOwner.email}`;
  $('#new-password').value='';$('#confirm-password').value='';
  $('#password-message').textContent=reason==='activation'?'Tu correo está verificado. Elegí tu contraseña para los próximos ingresos.':'Elegí una nueva contraseña para la cuenta indicada arriba.';
  $('#password-message').className='message';
  if(!$('#password-dialog').open)$('#password-dialog').showModal();
}
async function saveNewPassword(event){
  event.preventDefault();const password=$('#new-password').value,confirm=$('#confirm-password').value,message=$('#password-message');
  if(password!==confirm){message.textContent='Las contraseñas no coinciden.';message.className='message error';return;}
  const owner=passwordOwner&&{...passwordOwner};
  const {data:current,error:sessionError}=await client.auth.getSession();
  const verifiedSession=current?.session;
  if(sessionError||!owner||!verifiedSession?.access_token||verifiedSession.user?.id!==owner.id||verifiedSession.user?.email?.toLowerCase()!==owner.email){
    passwordOwner=null;$('#password-dialog').close();loginView.classList.remove('hidden');appView.classList.add('hidden');$('#login-message').textContent='La sesión cambió. Abrí nuevamente el enlace enviado al correo que querés recuperar o activar.';$('#login-message').className='message error';return;
  }
  message.textContent='Guardando…';message.className='message';
  try{
    // Bind the update to the verified identity even if another tab switches the shared Auth session.
    const response=await fetch(`${SUPABASE_URL}/auth/v1/user`,{method:'PUT',headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${verifiedSession.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({password})});
    const updated=await response.json().catch(()=>null);
    const updatedUser=updated?.user||updated;
    if(!response.ok||updatedUser?.id!==owner.id){message.textContent='No fue posible guardar la contraseña. Solicitá un enlace nuevo.';message.className='message error';return;}
  }catch{message.textContent='No se pudo conectar con el servicio de acceso. Revisá la conexión antes de intentarlo nuevamente.';message.className='message error';return;}
  passwordOwner=null;passwordRecoveryMode=false;activationHandled=true;activationMode=false;renderAuthMode();sessionStorage.removeItem('bonoalerta-activation');history.replaceState({},'',redirectUrl(false));message.textContent='Contraseña guardada.';setTimeout(()=>{$('#password-dialog').close();client.auth.getSession().then(({data})=>showSession(data.session));},600);
}

async function readRows(table,columns='*',configure=q=>q,order='created_at'){
  const data=[];
  for(let offset=0;;offset+=500){const result=await configure(client.from(table).select(columns)).order(order,{ascending:false}).range(offset,offset+499);if(result.error)return{data:null,error:result.error};data.push(...(result.data||[]));if((result.data||[]).length<500)return{data,error:null};}
}
async function readWatchRows(table,columns,ids){
  const data=[];for(let offset=0;offset<ids.length;offset+=80){const result=await readRows(table,columns,q=>q.in('watch_id',ids.slice(offset,offset+80)));if(result.error)return result;data.push(...result.data);}return{data:data.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||''))),error:null};
}
async function loadData() {
  if(!currentOrganization?.active)return;
  const organizationId=currentOrganization.id,sequence=++loadSequence;
  $('#sync-status').innerHTML='<i></i> Actualizando…';
  const watchResult=await readRows('monitor_watches','*',q=>q.eq('organization_id',organizationId));
  if(sequence!==loadSequence)return;
  if(watchResult.error){$('#sync-status').textContent='Error de actualización';toast('No fue posible cargar los expedientes de esta empresa');return;}
  const nextWatches=watchResult.data||[],ids=nextWatches.map(w=>w.id);
  const [eventResult,noteResult,taskResult,documentResult,profileResult]=await Promise.all([
    readWatchRows('monitor_outbox','id,watch_id,status,created_at,sent_at,before_states,after_states',ids),
    readWatchRows('monitor_notes','*',ids),readWatchRows('monitor_tasks','*',ids),readWatchRows('monitor_documents','*',ids),
    readRows('monitor_case_profiles','*',q=>q.eq('organization_id',organizationId),'watch_id')
  ]);
  if(sequence!==loadSequence)return;
  watches=nextWatches;events=eventResult.data||[];
  notes=noteResult.data||[];tasks=taskResult.data||[];documents=documentResult.data||[];
  caseProfiles=profileResult.data||[];caseFeaturesAvailable=!profileResult.error;
  $('#case-feature-message').classList.toggle('hidden',caseFeaturesAvailable);
  $('#case-feature-message').textContent=caseFeaturesAvailable?'':'La gestión integral requiere activar la migración de expedientes. Los estados existentes siguen disponibles.';
  if(['owner','admin'].includes(currentMembership?.role)){
    const [consentResult,requestResult,auditResult]=await Promise.all([
      readRows('monitor_client_consents','id,accepted_at,withdrawn_at',q=>q.eq('organization_id',organizationId),'accepted_at'),
      readRows('monitor_privacy_requests','*',q=>q.eq('organization_id',organizationId)),
      client.from('monitor_audit_log').select('id,action,entity_type,created_at').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(1000)
    ]);
    if(sequence!==loadSequence)return;
    consents=consentResult.data||[];privacyRequests=requestResult.data||[];auditEvents=auditResult.data||[];
  }
  render();
  $('#sync-status').innerHTML='<i></i> Sincronizado';
  if(eventResult.error||noteResult.error||taskResult.error||documentResult.error){$('#sync-status').textContent='Carga incompleta';toast('Algunos detalles no se pudieron actualizar');}
}

function render() {
  $('#metric-total').textContent=watches.length;
  $('#metric-active').textContent=watches.filter(w=>w.enabled).length;
  $('#metric-changes').textContent=events.length;
  $('#metric-errors').textContent=watches.filter(w=>trafficStatus(w)==='red').length;
  renderWatches($('#search').value);
  renderActivity();
  renderCompliance();
  operationsReports.render();
}

function renderCompliance(){
  const panel=$('#compliance-panel');if(!panel)return;
  const allowed=['owner','admin'].includes(currentMembership?.role);panel.classList.toggle('hidden',!allowed);if(!allowed)return;
  $('#metric-consents').textContent=consents.filter(c=>!c.withdrawn_at).length;
  $('#metric-privacy-requests').textContent=privacyRequests.filter(r=>['received','in_review'].includes(r.status)).length;
  $('#metric-audit').textContent=auditEvents.length;
  const pending=privacyRequests.filter(r=>['received','in_review'].includes(r.status));
  $('#privacy-request-list').innerHTML=pending.length?pending.map(r=>`<div class="activity"><span class="activity-dot"></span><div><p><strong>${escapeHtml(r.request_type)}</strong> · ${escapeHtml(r.email)}</p><small>${escapeHtml(r.details||'Sin detalle')}</small></div><small>${escapeHtml(formatDate(r.created_at))}</small></div>`).join(''):'<div class="empty">Sin solicitudes pendientes.</div>';
}

function renderWatches(query='') {
  const q=query.trim().toLowerCase();
  const status=$('#status-filter')?.value||'',priority=$('#priority-filter')?.value||'',emitted=$('#emitted-filter')?.value||'',deadline=$('#deadline-filter')?.value||'';
  const matchesDeadline=info=>!deadline||(!info?.completed&&((deadline==='expired'&&info?.days<0)||(deadline==='0-5'&&info?.days>=0&&info.days<=5)||(deadline==='6-10'&&info?.days>=6&&info.days<=10)||(deadline==='11-30'&&info?.days>=11&&info.days<=30)||(deadline==='31+'&&info?.days>=31)));
  const modality=$('#modality-filter').value,stage=$('#stage-filter').value;
  const rows=watches.filter(w=>{const info=formalizationInfo(w),p=profileFor(w),searchValues=[w.label,w.cedula,w.case_number,w.assigned_to,p?.financial_entity,latestState(w.last_states),info?'emitido':'',info?.elapsed,info?.days];return searchValues.some(v=>String(v??'').toLowerCase().includes(q));}).filter(w=>!status||trafficStatus(w)===status).filter(w=>!priority||w.priority===priority).filter(w=>!modality||profileFor(w)?.modality===modality).filter(w=>!stage||profileFor(w)?.workflow_stage===stage).filter(w=>{const info=formalizationInfo(w);return(!emitted||(emitted==='yes'&&info)||(emitted==='no'&&!info))&&matchesDeadline(info);});
  if($('#case-sort').value==='deadline')rows.sort((a,b)=>{const x=formalizationInfo(a),y=formalizationInfo(b);return (x&&!x.completed?x.days:Infinity)-(y&&!y.completed?y.days:Infinity);});
  $('#watch-list').innerHTML=rows.length?rows.map(w=>`<article class="watch-row ${trafficStatus(w)==='red'?'attention':trafficStatus(w)==='yellow'?'near-due':''}">
    <div class="watch-name"><div class="watch-icon">${escapeHtml((w.label||'E').slice(0,1).toUpperCase())}</div><div><strong><span class="traffic ${trafficStatus(w)}"></span>${escapeHtml(w.label||'Sin nombre')}</strong><small>Cédula ${escapeHtml(w.cedula)}</small><span class="priority">${escapeHtml(w.priority||'normal')} · ${escapeHtml(w.assigned_to||'Sin responsable')}</span></div></div>
    <div class="cell"><span class="cell-label">Caso BANHVI</span><strong>${w.case_number?`#${escapeHtml(w.case_number)}`:'Pendiente'}</strong><small>${escapeHtml(BonoCase.stages.find(s=>s.id===profileFor(w)?.workflow_stage)?.label||'Gestión por configurar')}</small></div>
    <div class="cell"><span class="cell-label">Estado actual</span><strong>${escapeHtml(latestState(w.last_states))}</strong><small>${escapeHtml(formatDate(w.last_success_at))}</small>${formalizationRowHtml(w)}${profileFor(w)?`<small>Documentación: ${BonoCase.checklistStats(profileFor(w).checklist).percent}% completa</small>`:''}</div>
    <div><span class="badge ${w.last_error?'error':w.enabled?'':'paused'}">${w.last_error?'Revisar':w.enabled?'Activo':'Pausado'}</span></div>
    <div class="row-actions"><button data-detail="${w.id}" title="Ver estados y gestionar">Ver</button>${canEditCases()?`<button data-toggle="${w.id}" title="${w.enabled?'Pausar':'Activar'}">${w.enabled?'Pausar':'Activar'}</button>`:''}</div>
  </article>`).join(''):'<div class="empty">No encontramos expedientes.</div>';
  document.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>openDetail(b.dataset.detail));
  document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>toggleWatch(b.dataset.toggle));
}

function renderActivity(){
  $('#activity-list').innerHTML=events.length?events.map(e=>{const w=watches.find(x=>x.id===e.watch_id);return `<div class="activity"><span class="activity-dot"></span><div><p><strong>${escapeHtml(w?.label||'Expediente')}</strong> registró un cambio de estado.</p><small>${e.status==='sent'?'Correo enviado':e.status==='review_required'?'Requiere revisión':'Notificación pendiente'}</small></div><small>${escapeHtml(formatDate(e.created_at))}</small></div>`}).join(''):'<div class="empty">Todavía no hay cambios nuevos. Todo permanece estable.</div>';
}

function stateDifference(before=[], after=[]) {
  const key=s=>`${s.date}|${s.description}`;
  const previous=new Set((before||[]).map(key)),current=new Set((after||[]).map(key));
  return {added:(after||[]).filter(s=>!previous.has(key(s))).map(s=>`${s.date} — ${s.description}`).join('\n'),removed:(before||[]).filter(s=>!current.has(key(s))).map(s=>`${s.date} — ${s.description}`).join('\n')};
}

async function exportExcel(){
  if(!watches.length){toast('No hay expedientes para exportar');return;}
  if(!['owner','admin'].includes(currentMembership?.role)){toast('Tu rol no permite exportar datos');return;}
  const button=$('#export-btn');button.disabled=true;button.textContent='Preparando Excel…';
  try{
    const xml=value=>String(value??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
    const sheet=(name,headers,rows)=>`<Worksheet ss:Name="${xml(name)}"><Table>${headers.map(h=>`<Column ss:Width="${h.width||120}"/>`).join('')}<Row ss:StyleID="Header">${headers.map(h=>`<Cell><Data ss:Type="String">${xml(h.label)}</Data></Cell>`).join('')}</Row>${rows.map(row=>`<Row>${headers.map(h=>`<Cell><Data ss:Type="String">${xml(row[h.key])}</Data></Cell>`).join('')}</Row>`).join('')}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>`;
    const summaryHeaders=[{label:'Nombre o referencia',key:'label',width:180},{label:'Cédula',key:'cedula',width:100},{label:'Caso BANHVI',key:'case',width:110},{label:'Monitoreo',key:'enabled',width:90},{label:'Estado actual',key:'state',width:220},{label:'Última revisión',key:'checked',width:150},{label:'Prioridad',key:'priority',width:90},{label:'Responsable',key:'assigned',width:140},{label:'Vencimiento',key:'due',width:130},{label:'Error reciente',key:'error',width:160}];
    const summaryRows=watches.map(w=>({label:w.label||'',cedula:w.cedula,case:w.case_number||'',enabled:w.enabled?'Activo':'Pausado',state:latestState(w.last_states),checked:formatDate(w.last_success_at),priority:w.priority||'normal',assigned:w.assigned_to||'',due:w.due_at?formatDate(w.due_at):'',error:w.last_error||''}));
    const stateHeaders=[{label:'Nombre o referencia',key:'label',width:180},{label:'Cédula',key:'cedula',width:100},{label:'Caso BANHVI',key:'case',width:110},{label:'Fecha del estado',key:'date',width:110},{label:'Descripción',key:'description',width:280}];
    const stateRows=watches.flatMap(w=>(w.last_states||[]).map(s=>({label:w.label||'',cedula:w.cedula,case:w.case_number||'',date:s.date,description:s.description})));
    const changeHeaders=[{label:'Nombre o referencia',key:'label',width:180},{label:'Cédula',key:'cedula',width:100},{label:'Caso BANHVI',key:'case',width:110},{label:'Detectado',key:'created',width:150},{label:'Notificación',key:'status',width:120},{label:'Correo enviado',key:'sent',width:150},{label:'Estados agregados',key:'added',width:300},{label:'Estados eliminados',key:'removed',width:300}];
    const changeRows=events.map(e=>{const w=watches.find(x=>x.id===e.watch_id)||{},diff=stateDifference(e.before_states,e.after_states);return{label:w.label||'',cedula:w.cedula||'',case:w.case_number||'',created:formatDate(e.created_at),status:e.status==='sent'?'Enviada':e.status==='review_required'?'Requiere revisión':'Pendiente',sent:e.sent_at?formatDate(e.sent_at):'',added:diff.added,removed:diff.removed};});
    const workbook=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0B3B47" ss:Pattern="Solid"/></Style></Styles>${sheet('Expedientes',summaryHeaders,summaryRows)}${sheet('Estados',stateHeaders,stateRows)}${sheet('Cambios',changeHeaders,changeRows)}</Workbook>`;
    const url=URL.createObjectURL(new Blob(['\ufeff',workbook],{type:'application/vnd.ms-excel'}));
    const link=document.createElement('a');link.href=url;link.download=`monitor-banhvi-${new Date().toISOString().slice(0,10)}.xls`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);await client.rpc('record_admin_event',{p_organization_id:currentOrganization.id,p_action:'export_excel',p_details:{records:watches.length}});toast('Excel descargado');
  }catch(error){console.error(error);toast('No fue posible generar el Excel');}
  finally{button.disabled=false;button.textContent='Exportar a Excel';}
}

async function addWatch(event){
  event.preventDefault(); const cedula=$('#cedula').value.trim(),label=$('#label').value.trim(),message=$('#add-message');
  if(!/^\d{9,12}$/.test(cedula)){message.textContent='Ingresá una cédula de 9 a 12 dígitos.';message.className='message error';return;}
  if(!currentOrganization){message.textContent='No hay una empresa activa para este usuario.';return;}
  const {data:created,error}=await client.from('monitor_watches').insert({organization_id:currentOrganization.id,cedula,label,enabled:true}).select('id,organization_id,created_at').single();
  if(error){message.textContent=error.code==='23505'?'Esa cédula ya está registrada.':'No se pudo guardar el expediente.';message.className='message error';return;}
  if(caseFeaturesAvailable){const defaults=BonoCase.profileDefaults(created),modality=$('#new-modality').value;const profile={...defaults,modality,checklist:BonoCase.requirementsFor(modality).map(r=>({...r,status:'pending',client_visible:false}))};const result=await client.from('monitor_case_profiles').insert(profile);if(result.error)toast('Expediente creado. Configurá sus requisitos desde Ver.');}
  $('#add-dialog').close(); $('#add-form').reset(); toast('Expediente agregado'); await loadData();openDetail(created.id);
}
async function toggleWatch(id){ const watch=watches.find(w=>w.id===id); if(!watch)return; const {error}=await client.from('monitor_watches').update({enabled:!watch.enabled}).eq('id',id); if(error){toast('No se pudo cambiar el monitoreo');return;} toast(watch.enabled?'Monitoreo pausado':'Monitoreo activado');await loadData(); }
function openDetail(id){
  const w=watches.find(x=>x.id===id);if(!w)return;currentWatchId=id;
  $('#detail-title').textContent=w.label||'Expediente';
  $('#detail-meta').innerHTML=`<span><i class="traffic ${trafficStatus(w)}"></i>Cédula ${escapeHtml(w.cedula)}</span><span>${w.case_number?`Caso #${escapeHtml(w.case_number)}`:'Caso pendiente'}</span><span>${w.enabled?'Activo':'Pausado'}</span>`;
  $('#internal-deadline').innerHTML=formalizationHtml(w);
  $('#integral-case-management').classList.toggle('hidden',!caseFeaturesAvailable);
  if(caseFeaturesAvailable)caseManager.open(w,profileFor(w)||{},documents);
  $('#save-management').disabled=!canEditCases();$('#send-client-access').disabled=!canEditCases();
  ['#note-form','#task-form','#document-form'].forEach(selector=>$(selector).querySelectorAll('input,textarea,button').forEach(el=>el.disabled=!canEditCases()));
  $('#print-case').classList.toggle('hidden',!['owner','admin'].includes(currentMembership?.role));
  const states=Array.isArray(w.last_states)?[...w.last_states].reverse():[];
  $('#state-list').innerHTML=states.length?states.map(s=>`<div class="state"><time>${escapeHtml(s.date)}</time><strong>${escapeHtml(s.description)}</strong></div>`).join(''):'<div class="empty">La primera revisión todavía no se ha completado.</div>';
  $('#detail-priority').value=w.priority||'normal';$('#detail-assigned').value=w.assigned_to||'';$('#detail-due').value=w.due_at?new Date(new Date(w.due_at)-new Date(w.due_at).getTimezoneOffset()*60000).toISOString().slice(0,16):'';$('#detail-client-email').value=w.client_email||'';$('#detail-client-portal').checked=!!w.client_portal_enabled;
  renderCaseManagement();$('#detail-dialog').showModal();
}

function renderCaseManagement(){
  const ownNotes=notes.filter(n=>n.watch_id===currentWatchId),ownTasks=tasks.filter(t=>t.watch_id===currentWatchId),ownDocs=documents.filter(d=>d.watch_id===currentWatchId);
  $('#note-list').innerHTML=ownNotes.length?ownNotes.map(n=>`<div class="mini-item"><p>${escapeHtml(n.body)}</p><small>${formatDate(n.created_at)}${n.client_visible?' · Visible para cliente':''}</small></div>`).join(''):'<small>Sin notas.</small>';
  $('#task-list').innerHTML=ownTasks.length?ownTasks.map(t=>`<div class="mini-item ${t.completed_at?'done':''}"><label class="check-row"><input type="checkbox" data-task="${t.id}" ${t.completed_at?'checked':''}> ${escapeHtml(t.title)}</label><small>${t.due_at?`Vence ${formatDate(t.due_at)}`:'Sin fecha límite'}</small></div>`).join(''):'<small>Sin tareas.</small>';
  $('#document-list').innerHTML=ownDocs.length?ownDocs.map(d=>`<div class="mini-item"><strong>${escapeHtml(d.name)}</strong><br><small>${formatDate(d.created_at)}${d.client_visible?' · Visible para cliente':''}</small></div>`).join(''):'<small>Sin documentos.</small>';
  document.querySelectorAll('[data-task]').forEach(el=>{el.disabled=!canEditCases();el.onchange=()=>toggleTask(el.dataset.task,el.checked);});
  caseManager.setDocuments(documents);
}

function openClientPreview(){
  const w=watches.find(x=>x.id===currentWatchId);if(!w)return;
  const sharedNotes=notes.filter(n=>n.watch_id===w.id&&n.client_visible),sharedDocs=documents.filter(d=>d.watch_id===w.id&&d.client_visible),states=Array.isArray(w.last_states)?[...w.last_states].reverse():[];
  $('#client-preview-title').textContent=w.label||'Su expediente';
  $('#client-preview-updated').textContent=`Última actualización: ${formatDate(w.last_success_at)}`;
  $('#client-preview-status').innerHTML=`<span class="traffic ${trafficStatus(w)}"></span>${escapeHtml(latestState(w.last_states))}`;
  $('#client-preview-states').innerHTML=states.length?states.map(s=>`<div class="state"><time>${escapeHtml(s.date)}</time><strong>${escapeHtml(s.description)}</strong></div>`).join(''):'<div class="empty">Aún no hay estados disponibles.</div>';
  $('#client-preview-notes').innerHTML=sharedNotes.length?sharedNotes.map(n=>`<div class="mini-item"><p>${escapeHtml(n.body)}</p><small>${formatDate(n.created_at)}</small></div>`).join(''):'<div class="empty">No hay información adicional compartida.</div>';
  $('#client-preview-documents').innerHTML=sharedDocs.length?sharedDocs.map(d=>`<div class="mini-item"><strong>${escapeHtml(d.name)}</strong><br><small>Documento disponible para el cliente</small></div>`).join(''):'<div class="empty">No hay documentos compartidos.</div>';
  $('#detail-dialog').close();$('#client-preview-dialog').classList.remove('hidden');
  document.body.style.overflow='hidden';
}

function closeClientPreview(){
  $('#client-preview-dialog').classList.add('hidden');
  document.body.style.overflow='';
}

async function saveManagement(){
  if(!currentWatchId)return;const patch={priority:$('#detail-priority').value,assigned_to:$('#detail-assigned').value.trim()||null,due_at:$('#detail-due').value?new Date($('#detail-due').value).toISOString():null,client_email:$('#detail-client-email').value.trim().toLowerCase()||null,client_portal_enabled:$('#detail-client-portal').checked};
  const {error}=await client.from('monitor_watches').update(patch).eq('id',currentWatchId);if(error){toast('No se pudo guardar la gestión');return;}toast('Gestión actualizada');await loadData();
}
async function sendClientAccess(){
  if(!currentWatchId)return;const message=$('#client-access-message'),watch=watches.find(w=>w.id===currentWatchId);
  if(!watch?.client_email||!watch?.case_number||!watch?.client_portal_enabled){message.textContent='Primero guardá el correo, esperá que exista el número de caso y activá el portal.';message.className='message error';return;}
  message.textContent='Preparando invitación…';message.className='message';const {error}=await client.rpc('enqueue_portal_invite',{p_watch_id:currentWatchId});
  if(error){message.textContent='No fue posible programar el correo. Verificá los datos e intentá nuevamente.';message.className='message error';return;}
  message.textContent='Invitación programada. Se enviará automáticamente en la próxima revisión, normalmente dentro de 30 minutos.';
}
async function addNote(event){event.preventDefault();const body=$('#note-body').value.trim();if(!body||!currentWatchId)return;const {error}=await client.from('monitor_notes').insert({watch_id:currentWatchId,body,client_visible:$('#note-visible').checked});if(error){toast('No se pudo guardar la nota');return;}event.target.reset();await loadData();renderCaseManagement();toast('Nota agregada');}
async function addTask(event){event.preventDefault();const title=$('#task-title').value.trim();if(!title||!currentWatchId)return;const {error}=await client.from('monitor_tasks').insert({watch_id:currentWatchId,title,due_at:$('#task-due').value?new Date($('#task-due').value).toISOString():null,assigned_to:$('#detail-assigned').value.trim()||null});if(error){toast('No se pudo crear la tarea');return;}event.target.reset();await loadData();renderCaseManagement();toast('Tarea creada');}
async function toggleTask(id,done){if(!canEditCases())return;const {error}=await client.from('monitor_tasks').update({completed_at:done?new Date().toISOString():null}).eq('id',id);if(error){toast('No se pudo actualizar la tarea');return;}await loadData();renderCaseManagement();}
async function uploadDocument(event){event.preventDefault();const file=$('#document-file').files[0];if(!file||!currentWatchId)return;if(file.size>10485760){toast('El archivo supera 10 MB');return;}const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=`${currentWatchId}/${crypto.randomUUID()}-${safe}`;const upload=await client.storage.from('monitor-documents').upload(path,file);if(upload.error){toast('No se pudo subir el documento');return;}const saved=await client.from('monitor_documents').insert({watch_id:currentWatchId,name:file.name,storage_path:path,client_visible:$('#document-visible').checked});if(saved.error){await client.storage.from('monitor-documents').remove([path]);toast('No se pudo registrar el documento');return;}event.target.reset();await loadData();renderCaseManagement();toast('Documento guardado');}

async function importCsv(file){
  const text=await file.text(),lines=text.replace(/^\ufeff/,'').split(/\r?\n/).filter(Boolean);if(!lines.length)return;
  const delimiter=lines[0].includes(';')?';':',';const header=lines[0].split(delimiter).map(v=>v.trim().toLowerCase());const cIndex=header.findIndex(v=>v.includes('cedula')||v.includes('cédula')),lIndex=header.findIndex(v=>v.includes('nombre')||v.includes('referencia'));
  if(cIndex<0){toast('El CSV necesita una columna cédula');return;}const rows=lines.slice(1).map(line=>line.split(delimiter)).map(cols=>({cedula:(cols[cIndex]||'').replace(/\D/g,''),label:(cols[lIndex]||'Expediente importado').trim(),enabled:true})).filter(r=>/^\d{9,12}$/.test(r.cedula));if(!rows.length){toast('No se encontraron cédulas válidas');return;}
  if(!currentOrganization){toast('No hay una empresa activa');return;}rows.forEach(row=>row.organization_id=currentOrganization.id);const {error}=await client.from('monitor_watches').upsert(rows,{onConflict:'organization_id,cedula',ignoreDuplicates:true});if(error){toast('No se pudo importar el archivo');return;}toast(`${rows.length} filas procesadas`);await loadData();
}

async function searchClientCase(event){
  event?.preventDefault();const email=$('#client-email').value.trim().toLowerCase(),cedula=$('#client-cedula').value.replace(/\D/g,''),caseNumber=$('#client-case').value.replace(/\D/g,''),message=$('#client-search-message');
  const {data:{session}}=await client.auth.getSession();
  if(!session){
    if(!$('#client-consent').checked){message.textContent='Debe aceptar el aviso de privacidad para continuar.';message.className='message error';return;}
    const pending={email,cedula,caseNumber,consent:true};localStorage.setItem('banhvi-client-pending',JSON.stringify(pending));message.textContent='Enviando enlace de verificación…';message.className='message';
    const {error}=await client.auth.signInWithOtp({email,options:{emailRedirectTo:BonoAuth.redirectUrl(location,{clientSlug:new URLSearchParams(location.search).get('cliente')||'1'}),shouldCreateUser:true}});
    if(error){message.textContent=BonoAuth.describeError(error);message.className='message error';return;}
    message.textContent='Revisá tu correo y abrí el enlace. Después mostraremos únicamente tu expediente.';return;
  }
  if(session.user.email?.toLowerCase()!==email){await client.auth.signOut();message.textContent='El correo verificado no coincide. Volvé a intentarlo.';message.className='message error';return;}
  message.textContent='Consultando…';message.className='message';
  const portalValue=new URLSearchParams(location.search).get('cliente'),orgSlug=portalValue&&portalValue!=='1'?portalValue:null;const {data,error}=await client.rpc('lookup_client_case',{p_cedula:cedula,p_case_number:caseNumber,p_org_slug:orgSlug});if(error||!data){message.textContent='No encontramos un expediente habilitado para ese correo y esos datos.';message.className='message error';return;}
  const consentResult=await client.rpc('record_client_consent',{p_watch_id:data.watch_id,p_policy_version:data.policy_version,p_user_agent:navigator.userAgent});if(consentResult.error){message.textContent='No fue posible registrar el consentimiento.';message.className='message error';return;}
  verifiedClientCase=data;localStorage.removeItem('banhvi-client-pending');
  const shared=await client.rpc('get_client_case_summary',{p_watch_id:data.watch_id});
  const stageLabel=BonoCase.stages.find(s=>s.id===shared.data?.workflow_stage)?.label;
  $('#public-client-summary').innerHTML=shared.error?'':BonoReports.clientSummaryHtml({client_summary:{advisor:shared.data?.assigned_to,next_step:stageLabel?`Etapa de gestión: ${stageLabel}. Consultá con tu asesor las próximas acciones.`:'',pending_documents:(shared.data?.requirements||[]).filter(r=>!['approved','not_applicable'].includes(r.status))}});
  message.textContent='';message.className='message';$('#client-search-panel').classList.add('hidden');$('#client-result').classList.remove('hidden');$('#public-client-title').textContent=data.label||'Su expediente';$('#public-client-updated').textContent=`Última actualización: ${formatDate(data.last_success_at)}`;$('#public-client-status').innerHTML=escapeHtml(latestState(data.last_states));
  const states=Array.isArray(data.last_states)?[...data.last_states].reverse():[];$('#public-client-states').innerHTML=states.length?states.map(s=>`<div class="state"><time>${escapeHtml(s.date)}</time><strong>${escapeHtml(s.description)}</strong></div>`).join(''):'<div class="empty">Aún no hay estados disponibles.</div>';$('#public-client-notes').innerHTML=(data.notes||[]).length?data.notes.map(n=>`<div class="mini-item"><p>${escapeHtml(n.body)}</p><small>${formatDate(n.created_at)}</small></div>`).join(''):'<div class="empty">No hay información adicional compartida.</div>';$('#public-client-documents').innerHTML=(data.documents||[]).length?data.documents.map(d=>`<div class="mini-item"><strong>${escapeHtml(d.name)}</strong></div>`).join(''):'<div class="empty">No hay documentos compartidos.</div>';
}

async function submitPrivacyRequest(event){
  event.preventDefault();const message=$('#rights-message'),portalValue=new URLSearchParams(location.search).get('cliente'),orgSlug=verifiedClientCase?.organization_slug||(portalValue&&portalValue!=='1'?portalValue:null);
  const {data:{session}}=await client.auth.getSession();if(!session||!orgSlug){message.textContent='Primero verificá tu correo consultando el expediente.';message.className='message error';return;}
  message.textContent='Enviando…';message.className='message';const {error}=await client.rpc('submit_privacy_request',{p_org_slug:orgSlug,p_request_type:$('#rights-type').value,p_details:$('#rights-details').value.trim()});
  if(error){message.textContent='No fue posible registrar la solicitud.';message.className='message error';return;}message.textContent='Solicitud recibida. Conservá este mensaje como confirmación.';event.target.reset();
}

async function loadPlatform(){
  if(!isPlatformAdmin)return;
  const [organizations,members,invites]=await Promise.all([readRows('monitor_organizations'),readRows('monitor_organization_members'),readRows('monitor_member_invites')]);
  if(organizations.error||members.error||invites.error){toast('No se pudieron actualizar las empresas y accesos');return;}
  platformManager.render(organizations.data,members.data,invites.data);
}
async function openAdminView(view){
  if(view==='platform'&&!isPlatformAdmin)return;
  currentAdminView=view;
  $('#admin-summary').classList.toggle('hidden',!['summary','cases'].includes(view)||!currentOrganization);
  $('#operations-reports').classList.toggle('hidden',view!=='reports'||!currentOrganization);
  $('#platform-admin').classList.toggle('hidden',view!=='platform');
  document.querySelectorAll('[data-admin-view]').forEach(button=>{const selected=button.dataset.adminView===view;button.classList.toggle('selected',selected);if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  if(view==='platform')await loadPlatform();else if(view==='reports')operationsReports.render();else if(view==='cases')$('#watch-list').scrollIntoView({behavior:'smooth',block:'start'});
}
function clearCompanyData(){
  loadSequence++;watches=[];events=[];notes=[];tasks=[];documents=[];caseProfiles=[];consents=[];privacyRequests=[];auditEvents=[];currentWatchId=null;
  $('#detail-dialog').close();$('#add-dialog').close();closeClientPreview();caseManager.close();render();
}
async function selectOrganization(id){
  const org=sessionOrganizations.find(o=>o.id===id&&o.active);if(!org)return;
  const member=sessionMemberships.find(m=>m.organization_id===id&&m.active);
  if(!isPlatformAdmin&&!member)return;
  clearCompanyData();currentOrganization=org;currentMembership=isPlatformAdmin?{organization_id:id,role:'owner',display_name:'Johan',active:true}:member;
  localStorage.setItem('bonoalerta-current-organization',id);$('#organization-picker').value=id;
  const manager=['owner','admin'].includes(currentMembership.role);
  $('#organization-name').textContent=org.name;$('#organization-plan').textContent=`${isPlatformAdmin?'Superadministrador · ':''}Plan ${org.plan} · ${isPlatformAdmin?'Acceso global':currentMembership.role} · hasta ${org.max_cases} expedientes`;
  $('#user-greeting').textContent=`Buenos días, ${currentMembership.display_name}`;
  $('#export-btn').classList.toggle('hidden',!manager);$('#import-btn').classList.toggle('hidden',!manager);$('#open-add').classList.toggle('hidden',!canEditCases());
  if(!['summary','cases','reports','platform'].includes(currentAdminView))currentAdminView='summary';await openAdminView(currentAdminView);await loadData();
}
let sessionSequence=0;
async function showSession(session){
  const sequence=++sessionSequence;
  if(passwordRecoveryMode){loginView.classList.remove('hidden');appView.classList.add('hidden');return;}
  if(activationMode&&!activationVerificationAccepted){
    currentOrganization=null;currentMembership=null;isPlatformAdmin=false;sessionUser=null;clearCompanyData();loginView.classList.remove('hidden');appView.classList.add('hidden');
    if(session){$('#login-message').textContent='Para activar otro acceso, verificá el correo autorizado con un enlace nuevo. La sesión anterior no cambiará su contraseña.';$('#login-message').className='message';}
    return;
  }
  if(!session){sessionUser=null;currentOrganization=null;currentMembership=null;isPlatformAdmin=false;sessionOrganizations=[];sessionMemberships=[];currentAdminView='summary';clearCompanyData();platformManager.render([],[],[]);$('#platform-admin').classList.add('hidden');$('#platform-navigation').classList.add('hidden');loginView.classList.remove('hidden');appView.classList.add('hidden');return;}
  sessionUser=session.user;const email=session.user.email?.toLowerCase();
  const [platform,members,organizations]=await Promise.all([client.rpc('platform_access'),readRows('monitor_organization_members','*',q=>q.eq('email',email).eq('active',true)),readRows('monitor_organizations')]);
  if(sequence!==sessionSequence)return;
  isPlatformAdmin=!platform.error&&platform.data===true;
  if(!isPlatformAdmin){platformManager.render([],[],[]);$('#platform-admin').classList.add('hidden');if(currentAdminView==='platform')currentAdminView='summary';}
  if(members.error||organizations.error){$('#login-message').textContent='No fue posible cargar los accesos. Volvé a intentar.';$('#login-message').className='message error';return;}
  sessionMemberships=members.data||[];sessionOrganizations=(organizations.data||[]).filter(org=>isPlatformAdmin||sessionMemberships.some(m=>m.organization_id===org.id));
  const active=sessionOrganizations.filter(org=>org.active);
  if(!isPlatformAdmin&&!active.length){currentOrganization=null;currentMembership=null;clearCompanyData();appView.classList.add('hidden');loginView.classList.remove('hidden');$('#login-message').textContent='Tu correo está verificado, pero todavía no tiene acceso a una empresa activa. Solicitá la asignación al superadministrador.';$('#login-message').className='message error';await client.auth.signOut();return;}
  $('#platform-navigation').classList.toggle('hidden',!isPlatformAdmin);
  $('#organization-picker').innerHTML=active.map(org=>`<option value="${escapeHtml(org.id)}">${escapeHtml(org.name)}</option>`).join('');
  $('#organization-picker-label').classList.toggle('hidden',active.length<2&&!isPlatformAdmin);
  loginView.classList.add('hidden');appView.classList.remove('hidden');
  const selected=active.find(org=>org.slug===authParams.get('empresa'))||active.find(org=>org.id===currentOrganization?.id)||active.find(org=>org.id===localStorage.getItem('bonoalerta-current-organization'))||active[0];
  if(selected)await selectOrganization(selected.id);else{currentOrganization=null;currentMembership=null;clearCompanyData();$('#organization-name').textContent='BonoAlerta';$('#organization-plan').textContent='Superadministrador';await openAdminView('platform');}
  if(!activationHandled&&activationMode&&activationVerificationAccepted){activationHandled=true;openPasswordDialog(session,'activation');}
}

$('#login-form').addEventListener('submit',signIn);$('#reset-password-btn').onclick=requestPasswordReset;$('#magic-link-btn').onclick=()=>requestMagicLink(false);$('#activate-access-btn').onclick=()=>requestMagicLink(true);$('#organization-picker').onchange=event=>selectOrganization(event.target.value);$('#password-form').addEventListener('submit',saveNewPassword); $('#add-form').addEventListener('submit',addWatch); $('#open-add').onclick=()=>$('#add-dialog').showModal(); $('#close-add').onclick=$('#cancel-add').onclick=()=>$('#add-dialog').close(); $('#close-detail').onclick=()=>$('#detail-dialog').close(); $('#refresh-btn').onclick=()=>currentAdminView==='platform'?loadPlatform():loadData(); $('#logout-btn').onclick=()=>client.auth.signOut(); $('#search').addEventListener('input',e=>renderWatches(e.target.value));
$('#export-btn').onclick=exportExcel;
['#status-filter','#priority-filter','#emitted-filter','#deadline-filter','#modality-filter','#stage-filter','#case-sort'].forEach(selector=>$(selector).onchange=()=>renderWatches($('#search').value));
$('#new-modality').innerHTML=BonoCase.modalities.map(m=>`<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('');
$('#modality-filter').innerHTML='<option value="">Todas las modalidades</option>'+$('#new-modality').innerHTML;
$('#stage-filter').innerHTML='<option value="">Todas las etapas internas</option>'+BonoCase.stages.map(s=>`<option value="${s.id}">${escapeHtml(s.label)}</option>`).join('');
$('#client-education').innerHTML=BonoReports.educationHtml();
document.querySelectorAll('[data-admin-view]').forEach(button=>button.onclick=()=>openAdminView(button.dataset.adminView));
$('#print-case').onclick=()=>{const w=watches.find(w=>w.id===currentWatchId);if(w)BonoReports.printCase(w,profileFor(w)||{},notes,documents,tasks);};
$('#import-btn').onclick=()=>$('#import-file').click();$('#import-file').onchange=event=>{const file=event.target.files[0];if(file)importCsv(file);event.target.value='';};
$('#save-management').onclick=saveManagement;$('#send-client-access').onclick=sendClientAccess;$('#note-form').addEventListener('submit',addNote);$('#task-form').addEventListener('submit',addTask);$('#document-form').addEventListener('submit',uploadDocument);
$('#open-client-preview').onclick=openClientPreview;$('#close-client-preview').onclick=closeClientPreview;
const routeParams=new URLSearchParams(location.search);
const clientMode=Boolean(routeParams.get('cliente'));
const adminMode=routeParams.get('admin')==='1';
function renderAuthMode(){const active=activationMode;$('#auth-description').textContent=active?'Verificá el correo al que el superadministrador asignó tu empresa. Después podrás elegir una contraseña.':'Ingresá a la empresa que te asignó el administrador.';$('#password').required=!active;$('#password').classList.toggle('hidden',active);document.querySelector('label[for="password"]').classList.toggle('hidden',active);$('#login-form button[type="submit"]').textContent=active?'Verificar correo y activar acceso':'Ingresar →';$('#activate-access-btn').classList.toggle('hidden',active);}
renderAuthMode();
const demoContent=$('#demo-preview-content');
if(demoContent){
  const demoSummary=demoContent.innerHTML;
  const demoViews={
    resumen:demoSummary,
    expedientes:`<div class="preview-title"><div><h2>Expedientes</h2><p>124 casos registrados · 118 activos</p></div><button type="button">+ Nuevo expediente</button></div><div class="demo-list"><div class="demo-list-row"><strong>Familia Rojas</strong><span class="demo-state">EMITIDO</span><small>22 días</small></div><div class="demo-list-row"><strong>Familia Rodríguez</strong><span class="demo-state warn">EN TRÁMITE</span><small>Actualizado hoy</small></div><div class="demo-list-row"><strong>Familia Méndez</strong><span class="demo-state">FORMALIZADO</span><small>Completado</small></div><div class="demo-list-row"><strong>Proyecto Los Pinos</strong><span class="demo-state">APROBADO</span><small>Sin alertas</small></div></div>`,
    clientes:`<div class="preview-title"><div><h2>Clientes</h2><p>Acceso seguro al estado de cada solicitud</p></div><button type="button">Invitar cliente</button></div><div class="demo-list"><div class="demo-list-row"><strong>María Rojas</strong><span>Portal activo</span><small>Ingresó hoy</small></div><div class="demo-list-row"><strong>José Rodríguez</strong><span>Invitación enviada</span><small>Ayer</small></div><div class="demo-list-row"><strong>Ana Méndez</strong><span>Portal activo</span><small>Hace 3 días</small></div></div>`,
    alertas:`<div class="preview-title"><div><h2>Alertas</h2><p>3 expedientes requieren atención</p></div></div><div class="demo-list"><div class="demo-list-row"><strong>Familia Rodríguez</strong><span class="demo-state warn">78 de 90 días</span><small>Formalizar pronto</small></div><div class="demo-list-row"><strong>Familia Solano</strong><span class="demo-state warn">Error de consulta</span><small>Revisar datos</small></div><div class="demo-list-row"><strong>Familia Vargas</strong><span class="demo-state">Cambio detectado</span><small>Correo enviado</small></div></div>`,
    reportes:`<div class="preview-title"><div><h2>Reportes</h2><p>Resumen operativo · últimos 6 meses</p></div><button type="button">Exportar</button></div><div class="report-kpis"><span><small>Expedientes activos</small><strong>118</strong><em>+12 este mes</em></span><span><small>Cambios detectados</small><strong>37</strong><em>96% notificados</em></span><span><small>Formalizados</small><strong>24</strong><em>Promedio: 63 días</em></span></div><div class="report-grid"><section><div class="report-section-title"><strong>Actividad mensual</strong><small>Consultas y cambios</small></div><div class="demo-report-bars" aria-label="Actividad mensual de ejemplo"><span style="--bar:38%"><b>18</b><i>May</i></span><span style="--bar:48%"><b>24</b><i>Jun</i></span><span style="--bar:72%"><b>36</b><i>Jul</i></span><span style="--bar:54%"><b>27</b><i>Ago</i></span><span style="--bar:88%"><b>44</b><i>Sep</i></span><span style="--bar:66%"><b>33</b><i>Oct</i></span></div></section><section class="status-breakdown"><div class="report-section-title"><strong>Estado de cartera</strong><small>124 expedientes</small></div><ul><li><i class="dot green"></i><span>En seguimiento</span><strong>72</strong></li><li><i class="dot mint"></i><span>Emitidos</span><strong>28</strong></li><li><i class="dot gold"></i><span>Por formalizar</span><strong>17</strong></li><li><i class="dot red"></i><span>Requieren atención</span><strong>7</strong></li></ul></section></div>`
  };
  document.querySelectorAll('[data-demo-tab]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-demo-tab]').forEach(item=>item.classList.toggle('active',item===button));demoContent.innerHTML=demoViews[button.dataset.demoTab]||demoSummary;}));
}
if(clientMode){landingView.classList.add('hidden');loginView.classList.add('hidden');appView.classList.add('hidden');$('#client-public-view').classList.remove('hidden');$('#client-search-form').addEventListener('submit',searchClientCase);$('#open-privacy').onclick=()=>$('#privacy-dialog').showModal();$('#close-privacy').onclick=()=>$('#privacy-dialog').close();$('#open-rights').onclick=()=>$('#rights-dialog').showModal();$('#close-rights').onclick=()=>$('#rights-dialog').close();$('#rights-form').addEventListener('submit',submitPrivacyRequest);$('#client-new-search').onclick=async()=>{$('#client-result').classList.add('hidden');$('#client-search-panel').classList.remove('hidden');$('#client-search-form').reset();verifiedClientCase=null;await client.auth.signOut();};const pending=JSON.parse(localStorage.getItem('banhvi-client-pending')||'null');if(pending){$('#client-email').value=pending.email;$('#client-cedula').value=pending.cedula;$('#client-case').value=pending.caseNumber;$('#client-consent').checked=!!pending.consent;}client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_IN'&&session&&pending)setTimeout(()=>searchClientCase(),0);});client.auth.getSession().then(({data})=>{if(data.session&&pending)searchClientCase();});}
else if(adminMode){landingView.classList.add('hidden');loginView.classList.remove('hidden');client.auth.onAuthStateChange((event,session)=>{
  if(event==='PASSWORD_RECOVERY'){passwordRecoveryMode=true;setTimeout(()=>openPasswordDialog(session,'recovery'),0);return;}
  if(activationMode&&event==='SIGNED_IN'&&initialActivation.verifiedCallback){
    const expectedEmail=sessionStorage.getItem('bonoalerta-activation');
    if(expectedEmail&&session?.user?.email?.toLowerCase()!==expectedEmail){
      activationVerificationAccepted=false;passwordOwner=null;setTimeout(()=>{$('#password-dialog').close();loginView.classList.remove('hidden');appView.classList.add('hidden');$('#login-message').textContent='El enlace corresponde a otro correo. Solicitá uno nuevo para el correo que querés activar.';$('#login-message').className='message error';},0);return;
    }
    activationVerificationAccepted=true;
  }
  setTimeout(()=>showSession(session),0);
});client.auth.getSession().then(({data})=>showSession(data.session));}
else{loginView.classList.add('hidden');appView.classList.add('hidden');landingView.classList.remove('hidden');}
})();
