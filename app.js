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
let checkRequests = [];
let caseChoices = [];
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
let intakeAvailable = false;
let isPlatformAdmin = false;
let sessionOrganizations = [];
let sessionMemberships = [];
let sessionUser = null;
let currentAdminView = 'summary';
let loadSequence = 0;
const watchPagination = {page:1,pageSize:10,criteria:''};
const activityPagination = {page:1,pageSize:10};
let activationHandled = false;
let activationVerificationAccepted = false;
let passwordOwner = null;
const authParams = new URLSearchParams(location.search);
let activationMode = authParams.get('activar')==='1';
const profileFor = watch => caseProfiles.find(p=>p.watch_id===watch.id);
const canEditCases = () => ['owner','admin','agent'].includes(currentMembership?.role);
const caseManager = BonoManagement.mount({container:'#integral-case-management',client,getContext:()=>({organization:currentOrganization,membership:currentMembership,intakeAvailable}),onSaved:async()=>{await loadData();const watch=watches.find(w=>w.id===currentWatchId);if(watch)$('#internal-deadline').innerHTML=formalizationHtml(watch);},toast});
const operationsReports = BonoReports.mount({container:'#operations-reports',getData:()=>({organizationId:currentOrganization?.id,watches,profiles:caseProfiles,events,documents,tasks}),onOpen:id=>openDetail(id),canExport:()=>['owner','admin'].includes(currentMembership?.role),toast});
const platformManager = BonoPlatform.mount({container:'#platform-admin',client,getContext:()=>({isPlatformAdmin,currentOrganization}),onChanged:async()=>{if(sessionUser)await showSession({user:sessionUser});},toast});
const workbookImporter=BonoImport.mount({client,getContext:()=>({organization:currentOrganization,membership:currentMembership,userId:sessionUser?.id,watches,intakeAvailable}),onImported:async()=>loadData(),toast});

const needsCaseReview=watch=>watch.last_error==='CASE_SELECTION_REQUIRED';
function caseReviewLabel(watch){
  if(caseChoices.some(c=>c.watch_id===watch.id&&c.selected_case_number))return 'Caso elegido · pendiente de consulta';
  return watch.case_number?'Revisar casos disponibles':'Pendiente de elegir caso';
}
function consultationNoticeHtml(watch){
  if(!watch.last_error)return '';
  const date=watch.last_attempt_at?` (${escapeHtml(formatDate(watch.last_attempt_at))})`:'';
  if(needsCaseReview(watch))return `<small>Revisión de casos${date}: ${escapeHtml(caseReviewLabel(watch))}. Abrí el detalle para continuar.</small>`;
  return `<small>Último intento con error${date}: ${escapeHtml(consultationErrorLabel(watch.last_error))}</small>`;
}
function trafficStatus(watch){
  if(watch.last_error&&!needsCaseReview(watch))return 'red';
  if(watch.due_at){const hours=(new Date(watch.due_at)-Date.now())/36e5;if(hours<0)return 'red';if(hours<72)return 'yellow';}
  if(needsCaseReview(watch))return 'yellow';
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
  if (!Array.isArray(states) || !states.length) return 'Sin consulta BANHVI completada';
  return [...states].sort((a,b) => { const [da,ma,ya]=a.date.split('/').map(Number),[db,mb,yb]=b.date.split('/').map(Number); return new Date(yb,mb-1,db)-new Date(ya,ma-1,da); })[0].description;
}
function documentationLabel(profile){
  const checklist=Array.isArray(profile.checklist)?profile.checklist:[];
  if(!checklist.length)return 'Documentación interna: sin requisitos configurados';
  const stats=BonoCase.checklistStats(checklist);
  return stats.total?`Documentación interna: ${stats.percent}% completa`:'Documentación interna: no aplica';
}
function consultationErrorLabel(value){
  const code=String(value||'');
  const messages={CASE_SELECTION_REQUIRED:'BANHVI devolvió varios casos o el caso vinculado no aparece. Abrí «Ver» para revisar',CASE_IDENTITY_CHANGED:'BANHVI abrió un caso distinto del vinculado; conservamos los estados anteriores',CASE_NOT_FOUND:'BANHVI no devolvió resultados para esta cédula en la última búsqueda',CASE_NOT_RESOLVED:'No se pudo abrir un caso automáticamente; requiere revisión'};
  messages.STATES_TABLE_UNAVAILABLE='El robot no encontró la tabla de estados';messages.STATES_CONTROLS_NOT_READY='Los controles de Estados no terminaron de cargar';messages.STATES_PANEL_NOT_OPEN='La sección Estados no se abrió correctamente';
  return Object.hasOwn(messages,code)?`${messages[code]} (${code})`:code;
}
function queuedCheckHtml(w){
  const request=checkRequests.find(r=>r.watch_id===w.id&&r.status==='pending');
  return request?`<small data-request-time>Consulta solicitada: ${escapeHtml(formatDate(request.requested_at))} · pendiente de ejecución</small>`:'';
}
const monitorFilters={
  __unattempted:{label:'Por consultar',matches:w=>w.enabled&&!w.last_attempt_at&&!w.last_success_at&&!w.last_error},
  __technical:{label:'Consultas con fallo técnico',matches:w=>w.enabled&&w.last_error&&!['CASE_NOT_FOUND','CASE_SELECTION_REQUIRED','CASE_IDENTITY_CHANGED'].includes(w.last_error)},
  __case_review:{label:'Casos por confirmar',matches:w=>w.enabled&&['CASE_SELECTION_REQUIRED','CASE_IDENTITY_CHANGED'].includes(w.last_error)},
  __pending_success:{label:'Sin resultado guardado',matches:w=>w.enabled&&!w.last_success_at&&!w.last_states?.length},
  __queued:{label:'Solicitudes en espera',matches:w=>w.enabled&&checkRequests.some(r=>r.watch_id===w.id&&r.status==='pending')}
};
function renderMonitorHealth(){
  const el=$('#monitor-health');if(!el)return;
  const successful=watches.filter(w=>w.last_success_at||w.last_states?.length);
  const latest=Math.max(...successful.map(w=>Date.parse(w.last_success_at)).filter(Number.isFinite));
  const oldest=Math.min(...watches.filter(w=>w.enabled).map(w=>Date.parse(w.last_attempt_at)).filter(Number.isFinite));
  el.textContent=watches.length
    ? `${successful.length} de ${watches.length} expedientes tienen un resultado guardado.${Number.isFinite(latest)?' Última consulta exitosa: '+formatDate(latest):''}`
    : 'Cuando agregués expedientes, acá verás el avance de las consultas.';
  $('#monitor-freshness').textContent=[
    'Un expediente puede estar sin resultado porque espera su primera consulta o porque BANHVI todavía no devolvió información.',
    'El botón Actualizar carga los resultados guardados.',
    Number.isFinite(oldest)?'Intento registrado más antiguo entre los expedientes activos: '+formatDate(oldest):''
  ].filter(Boolean).join(' ');
  document.querySelectorAll('[data-monitor-filter]').forEach(button=>{
    const filter=monitorFilters[button.dataset.monitorFilter];
    const count=watches.filter(filter.matches).length;
    button.textContent=`${filter.label} (${count})`;
    button.classList.toggle('hidden',count===0);
  });
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
async function readWatchRows(table,columns,ids,order='created_at'){
  const data=[];for(let offset=0;offset<ids.length;offset+=80){const result=await readRows(table,columns,q=>q.in('watch_id',ids.slice(offset,offset+80)),order);if(result.error)return result;data.push(...result.data);}return{data:data.sort((a,b)=>String(b[order]||'').localeCompare(String(a[order]||''))),error:null};
}
let dismissedConsultations='',pendingConsultations='',checkingConsultations=false,consultationBaselineReady=false;

async function checkForConsultationResults(){
  const organizationId=currentOrganization?.id,sequence=loadSequence;
  if(!organizationId||!consultationBaselineReady||checkingConsultations||document.hidden||appView.classList.contains('hidden'))return;
  checkingConsultations=true;
  try{
    const result=await readRows('monitor_watches','id,last_attempt_at,last_success_at',q=>q.eq('organization_id',organizationId),'id');
    if(result.error||sequence!==loadSequence||organizationId!==currentOrganization?.id)return;
    const displayed=new Map(watches.map(w=>[w.id,w]));
    const changed=result.data.filter(w=>{
      const previous=displayed.get(w.id);
      return previous&&(w.last_attempt_at!==previous.last_attempt_at||w.last_success_at!==previous.last_success_at);
    });
    pendingConsultations=JSON.stringify(changed.map(w=>[w.id,w.last_attempt_at,w.last_success_at]).sort());
    $('#consultation-refresh').classList.toggle('hidden',!changed.length||pendingConsultations===dismissedConsultations);
  }catch{
    // Keep the panel usable if the check cannot reach the server.
  }finally{
    checkingConsultations=false;
  }
}

async function loadData() {
  if(!currentOrganization?.active)return;
  const organizationId=currentOrganization.id,sequence=++loadSequence;
  $('#sync-status').innerHTML='<i></i> Actualizando…';
  const watchResult=await readRows('monitor_watches','*',q=>q.eq('organization_id',organizationId));
  if(sequence!==loadSequence)return;
  if(watchResult.error){$('#sync-status').textContent='Error de actualización';toast('No fue posible cargar los expedientes de esta empresa');return;}
  const nextWatches=watchResult.data||[],ids=nextWatches.map(w=>w.id);
  const [eventResult,noteResult,taskResult,documentResult,profileResult,intakeProbe,checkResult,choicesResult]=await Promise.all([
    readWatchRows('monitor_outbox','id,watch_id,status,created_at,sent_at,before_states,after_states',ids),
    readWatchRows('monitor_notes','*',ids),readWatchRows('monitor_tasks','*',ids),readWatchRows('monitor_documents','*',ids),
    readRows('monitor_case_profiles','*',q=>q.eq('organization_id',organizationId),'watch_id'),
    client.from('monitor_case_profiles').select('watch_id,intake_data').eq('organization_id',organizationId).limit(1),
    readWatchRows('monitor_check_requests','watch_id,status,requested_at,completed_at,last_error',ids,'requested_at'),
    readWatchRows('monitor_case_choices','watch_id,case_numbers,selected_case_number,observed_at',ids,'observed_at')
  ]);
  if(sequence!==loadSequence)return;
  watches=nextWatches;events=eventResult.data||[];
  checkRequests=checkResult.data||[];
  caseChoices=choicesResult.data||[];
  notes=noteResult.data||[];tasks=taskResult.data||[];documents=documentResult.data||[];
  caseProfiles=profileResult.data||[];caseFeaturesAvailable=!profileResult.error;
  intakeAvailable=!intakeProbe.error;
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
  consultationBaselineReady=true;
  $('#consultation-refresh').classList.add('hidden');
  $('#sync-status').innerHTML='<i></i> Datos del panel actualizados';
  if(eventResult.error||noteResult.error||taskResult.error||documentResult.error){$('#sync-status').textContent='Carga incompleta';toast('Algunos detalles no se pudieron actualizar');}
}

function render() {
  const official=$('#official-status-filter'),selected=official.value;
  const labels=[...new Set(watches.filter(w=>w.last_states?.length).map(w=>latestState(w.last_states)))].sort((a,b)=>a.localeCompare(b,'es'));
  official.innerHTML='<option value="">Todos los estados BANHVI</option><option value="__unread">Sin historial guardado</option><option value="__choose">Casos por revisar o elegir</option>'+Object.entries(monitorFilters).map(([key,filter])=>`<option value="${key}">${filter.label} (activos)</option>`).join('')+labels.map(label=>`<option value="${escapeHtml(label)}">BANHVI: ${escapeHtml(label)}</option>`).join('');
  official.value=['__unread','__choose'].includes(selected)||Object.hasOwn(monitorFilters,selected)||labels.includes(selected)?selected:'';
  $('#metric-total').textContent=watches.length;
  $('#metric-active').textContent=watches.filter(w=>w.enabled).length;
  $('#metric-errors').textContent=watches.filter(w=>trafficStatus(w)==='red').length;
  renderWatches($('#search').value);
  renderActivity();
  renderFollowupSummary();
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

function paginationRange(state,total){
  const pages=Math.max(1,Math.ceil(total/state.pageSize));state.page=Math.min(Math.max(1,state.page),pages);
  return{pages,start:(state.page-1)*state.pageSize,end:Math.min(state.page*state.pageSize,total)};
}
function renderPagination(selector,state,total,onChange,{label,pageSizes=false}={}){
  const container=$(selector);if(!container)return;
  if(!total){container.innerHTML='';return;}
  const range=paginationRange(state,total),numbers=range.pages<=5?Array.from({length:range.pages},(_,index)=>index+1):[...new Set([1,...[state.page-1,state.page,state.page+1].filter(page=>page>1&&page<range.pages),range.pages])].sort((a,b)=>a-b);
  const pageButtons=numbers.map((page,index)=>`${index&&page-numbers[index-1]>1?'<span class="list-pagination-gap" aria-hidden="true">…</span>':''}<button type="button" data-pagination-page="${page}" aria-label="Ir a página ${page} de ${escapeHtml(label)}" ${state.page===page?'aria-current="page"':''}>${page}</button>`).join('');
  container.innerHTML=`<div class="list-pagination"><span class="list-pagination-summary" data-pagination-summary role="status" aria-live="polite" aria-atomic="true">Mostrando ${range.start+1}–${range.end} de ${total}</span>${pageSizes?`<label class="list-pagination-size"><span>Por página</span><select data-pagination-size aria-label="${escapeHtml(label)} por página">${[10,25,50].map(size=>`<option value="${size}" ${state.pageSize===size?'selected':''}>${size}</option>`).join('')}</select></label>`:''}<nav aria-label="Paginación de ${escapeHtml(label)}"><button type="button" data-pagination-prev data-pagination-page="${state.page-1}" ${state.page===1?'disabled':''}>Anterior</button><div class="list-pagination-numbers">${pageButtons}</div><button type="button" data-pagination-next data-pagination-page="${state.page+1}" ${state.page===range.pages?'disabled':''}>Siguiente</button></nav></div>`;
  container.querySelectorAll('[data-pagination-page]').forEach(button=>button.onclick=()=>{if(button.disabled)return;state.page=Number(button.dataset.paginationPage);onChange();container.querySelector('[aria-current="page"]')?.focus({preventScroll:true});});
  const size=container.querySelector('[data-pagination-size]');if(size)size.onchange=()=>{state.pageSize=Number(size.value);state.page=1;onChange();container.querySelector('[data-pagination-size]')?.focus({preventScroll:true});};
}

function renderWatches(query='') {
  renderMonitorHealth();
  const q=query.trim().toLowerCase();
  const status=$('#status-filter')?.value||'',priority=$('#priority-filter')?.value||'',emitted=$('#emitted-filter')?.value||'',deadline=$('#deadline-filter')?.value||'';
  const matchesDeadline=info=>!deadline||(!info?.completed&&((deadline==='expired'&&info?.days<0)||(deadline==='0-5'&&info?.days>=0&&info.days<=5)||(deadline==='6-10'&&info?.days>=6&&info.days<=10)||(deadline==='11-30'&&info?.days>=11&&info.days<=30)||(deadline==='31+'&&info?.days>=31)));
  const modality=$('#modality-filter').value,stage=$('#stage-filter').value;
  const officialStatus=$('#official-status-filter').value;
  const criteria=JSON.stringify([q,status,priority,emitted,deadline,modality,stage,officialStatus,$('#case-sort').value]);
  if(watchPagination.criteria!==criteria){watchPagination.page=1;watchPagination.criteria=criteria;}
  const rows=watches.filter(w=>BonoCase.matchesCaseSearch(w,profileFor(w)||{},q))
    .filter(w=>!officialStatus||(officialStatus==='__unread'?!w.last_states?.length:officialStatus==='__choose'?needsCaseReview(w):Object.hasOwn(monitorFilters,officialStatus)?monitorFilters[officialStatus].matches(w):latestState(w.last_states)===officialStatus))
    .filter(w=>!status||trafficStatus(w)===status).filter(w=>!priority||w.priority===priority).filter(w=>!modality||profileFor(w)?.modality===modality).filter(w=>!stage||profileFor(w)?.workflow_stage===stage)
    .filter(w=>{const info=formalizationInfo(w),completed=BonoCase.formalizationComplete(w,profileFor(w)||{});return(!emitted||(emitted==='yes'&&info)||(emitted==='no'&&!info)||(emitted==='completed'&&completed)||(emitted==='pending'&&info&&!completed))&&matchesDeadline(info);});
  if($('#case-sort').value==='deadline')rows.sort((a,b)=>{const x=formalizationInfo(a),y=formalizationInfo(b);return (x&&!x.completed?x.days:Infinity)-(y&&!y.completed?y.days:Infinity);});
  const pageRange=paginationRange(watchPagination,rows.length),pageRows=rows.slice(pageRange.start,pageRange.end);
  $('#watch-list').innerHTML=rows.length?pageRows.map(w=>`<article class="watch-row ${trafficStatus(w)==='red'?'attention':trafficStatus(w)==='yellow'?'near-due':''}">
    <div class="watch-name"><div class="watch-icon">${escapeHtml((w.label||'E').slice(0,1).toUpperCase())}</div><div><strong><span class="traffic ${trafficStatus(w)}"></span>${escapeHtml(w.label||'Sin nombre')}</strong><small>Cédula ${escapeHtml(w.cedula)}</small><span class="priority">${escapeHtml(w.priority||'normal')} · ${escapeHtml(w.assigned_to||'Sin responsable')}</span></div></div>
    <div class="cell"><span class="cell-label">Caso BANHVI</span><strong>${w.case_number?`#${escapeHtml(w.case_number)}`:'Caso aún no obtenido'}</strong><small>Gestión interna: ${escapeHtml(BonoCase.stages.find(s=>s.id===profileFor(w)?.workflow_stage)?.label||'por configurar')}</small></div>
    <div class="cell"><span class="cell-label">Estado BANHVI (consulta)</span><strong>${escapeHtml(latestState(w.last_states))}</strong>${w.last_success_at?`<small>Última consulta completada: ${escapeHtml(formatDate(w.last_success_at))}</small>`:''}${consultationNoticeHtml(w)}${queuedCheckHtml(w)}${formalizationRowHtml(w)}${profileFor(w)?`<small>${escapeHtml(documentationLabel(profileFor(w)))}</small>`:''}</div>
    <div><span class="badge ${needsCaseReview(w)?'case-selection':w.last_error?'error':w.enabled?'':'paused'}">${needsCaseReview(w)?escapeHtml(caseReviewLabel(w)):w.last_error?'Revisar consulta':w.enabled?'Monitoreo activo':'Monitoreo pausado'}</span></div>
    <div class="row-actions"><button data-detail="${w.id}" title="Ver estados y gestionar">${needsCaseReview(w)&&!caseChoices.some(c=>c.watch_id===w.id&&c.selected_case_number)?w.case_number?'Revisar casos':'Elegir caso':'Ver'}</button>${canEditCases()?`<button data-check="${w.id}" title="Solicitar revisión prioritaria en la próxima ejecución del robot" ${!w.enabled||checkRequests.some(r=>r.watch_id===w.id&&r.status==='pending')?'disabled':''}>${checkRequests.some(r=>r.watch_id===w.id&&r.status==='pending')?'Consulta en cola':'Consultar BANHVI'}</button><button data-toggle="${w.id}" title="${w.enabled?'Pausar':'Activar'}">${w.enabled?'Pausar':'Activar'}</button>`:''}</div>
  </article>`).join(''):'<div class="empty">No encontramos expedientes.</div>';
  document.querySelectorAll('[data-detail]').forEach(b=>b.onclick=()=>openDetail(b.dataset.detail));
  document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=()=>toggleWatch(b.dataset.toggle));
  document.querySelectorAll('[data-check]').forEach(b=>b.onclick=()=>requestWatchCheck(b.dataset.check,b));
  renderPagination('#watch-pagination',watchPagination,rows.length,()=>renderWatches($('#search').value),{label:'expedientes',pageSizes:true});
}

function renderCaseChoices(w){
  const section=$('#case-choices'),choices=caseChoices.find(c=>c.watch_id===w.id);
  const numbers=[...new Set((Array.isArray(choices?.case_numbers)?choices.case_numbers:[]).filter(n=>/^\d{5,20}$/.test(n)))];
  const required=w.last_error==='CASE_SELECTION_REQUIRED';
  section.classList.toggle('hidden',!numbers.length&&!required);
  if(!numbers.length){section.innerHTML=required?'<strong>Hay varios casos por revisar</strong><p>Para ver las opciones, activá el SQL de selección de casos y solicitá otra consulta.</p>':'';return;}
  const linked=w.case_number||choices.selected_case_number;
  section.innerHTML=`<strong>Casos detectados en BANHVI</strong><p>${linked?`Seguiremos el caso #${escapeHtml(linked)}. Los otros casos no se mezclan con este expediente.`:'Elegí el caso que corresponde a este expediente. La próxima consulta obtendrá únicamente sus estados.'}</p><form id="select-case-form"><label>Caso a monitorear<select id="select-case-number" required ${linked||!canEditCases()?'disabled':''}><option value="">Seleccioná un caso</option>${numbers.map(n=>`<option value="${n}" ${linked===n?'selected':''}>#${n}</option>`).join('')}</select></label>${!linked&&canEditCases()?`<button type="submit" ${!w.enabled?'disabled':''}>Elegir y solicitar consulta</button>`:''}</form><small id="case-choice-message" role="status">${!w.enabled?'Activá el monitoreo para solicitar la consulta.':''}</small>`;
  const form=$('#select-case-form');form.onsubmit=async event=>{
    event.preventDefault();const number=$('#select-case-number').value;if(!numbers.includes(number)||!canEditCases())return;
    const organizationId=currentOrganization?.id,button=form.querySelector('button'),message=$('#case-choice-message');button.disabled=true;message.textContent='Guardando selección…';
    try{
      const {data,error}=await client.rpc('select_banhvi_case',{p_watch_id:w.id,p_case_number:number});
      if(organizationId!==currentOrganization?.id||currentWatchId!==w.id)return;
      if(error){message.textContent=error.message?.includes('cinco minutos')?'Esperá cinco minutos desde la última solicitud y probá de nuevo.':'No se pudo elegir el caso. Actualizá el panel para revisar sus opciones y permisos.';button.disabled=false;return;}
      choices.selected_case_number=number;
      checkRequests=checkRequests.filter(r=>r.watch_id!==w.id);checkRequests.push({watch_id:w.id,...data});
      renderCaseChoices(w);renderWatches($('#search').value);toast('Caso elegido. Consulta en cola para la próxima ejecución');
    }catch{message.textContent='No se pudo conectar. Intentá nuevamente.';button.disabled=false;}
  };
}

async function requestWatchCheck(id,button){
  if(!canEditCases()||!watches.some(w=>w.id===id&&w.enabled))return;
  const organizationId=currentOrganization?.id;
  button.disabled=true;button.textContent='Solicitando…';
  try{
    const {data,error}=await client.rpc('request_banhvi_check',{p_watch_id:id});
    if(organizationId!==currentOrganization?.id)return;
    if(error){
      if(error.code==='PGRST202'||error.code==='42883')toast('Falta activar el SQL de consultas individuales en Supabase');
      else if(error.message?.includes('cinco minutos'))toast('Esperá cinco minutos entre solicitudes de este expediente');
      else toast('No se pudo solicitar la consulta. Verificá tus permisos y que el monitoreo esté activo');
      return;
    }
    checkRequests=checkRequests.filter(r=>r.watch_id!==id);
    checkRequests.push({watch_id:id,...data});
    toast('Consulta en cola: tendrá prioridad en la próxima ejecución del robot');
  }catch{toast('No se pudo conectar. Intentá nuevamente');}
  finally{if(organizationId===currentOrganization?.id)renderWatches($('#search').value);}
}

function renderSummaryCharts(today, eventsByDay, alertsByDay){
  const date=new Date(today+'T12:00:00Z');
  const weekday=new Intl.DateTimeFormat('es-CR',{weekday:'short',timeZone:'UTC'});
  const week=Array.from({length:7},(_,index)=>{
    const day=new Date(date);
    day.setUTCDate(date.getUTCDate()-6+index);
    const key=day.toISOString().slice(0,10);
    return {label:weekday.format(day),day:day.getUTCDate(),changes:eventsByDay.get(key)||0,alerts:alertsByDay.get(key)||0};
  });
  const peak=Math.max(1,...week.flatMap(day=>[day.changes,day.alerts]));
  $('#weekly-activity-chart').innerHTML=week.map(({label,day,changes,alerts})=>`
    <li aria-label="${label} ${day}. ${changes} cambios de estado, ${alerts} alertas por correo">
      <div class="weekly-bars" aria-hidden="true">
        <div class="chart-change" style="--bar-height:${changes/peak*100}%"><span>${changes}</span></div>
        <div class="chart-alert" style="--bar-height:${alerts/peak*100}%"><span>${alerts}</span></div>
      </div>
      <small>${label} ${day}</small>
    </li>`).join('');

  const month=today.slice(0,7);
  const active=watches.filter(watch=>watch.enabled);
  const consulted=active.filter(watch=>Number.isFinite(Date.parse(watch.last_success_at))&&BonoCase.todayISO(watch.last_success_at).startsWith(month)).length;
  $('#monthly-period').textContent=new Intl.DateTimeFormat('es-CR',{month:'long',year:'numeric',timeZone:'UTC'}).format(date);
  $('#monthly-coverage-count').textContent=active.length?`${consulted} de ${active.length}`:'Sin expedientes activos';
  const coverage=$('#monthly-coverage');
  coverage.max=active.length||1;
  coverage.value=consulted;
}

// Salir: primero intenta cerrar la sesión en el servidor. Si el servidor la rechaza
// (403/401: sesión ya revocada o vencida), la cierra igual en este navegador para
// que el usuario nunca quede atrapado adentro.
async function signOutPanel(){
  const button=$('#logout-btn');button.disabled=true;
  try{
    const {error}=await client.auth.signOut();
    if(error)await client.auth.signOut({scope:'local'});
  }catch{
    try{await client.auth.signOut({scope:'local'});}catch{}
  }finally{button.disabled=false;}
  const {data}=await client.auth.getSession();
  if(data?.session){
    Object.keys(localStorage).filter(key=>key.startsWith('sb-')).forEach(key=>localStorage.removeItem(key));
    location.reload();
  }
}
const RECENT_ACTIVITY_DAYS=7;
// Seguimiento de formalización en el Resumen: primero las metas por vencer, después las vencidas.
const followupRank=days=>days>=0?days:100000-days;
const FOLLOWUP_SUMMARY_LIMIT=5;
function renderFollowupSummary(){
  const list=$('#followup-list');if(!list)return;
  const rows=watches.map(watch=>({watch,info:formalizationInfo(watch)}))
    .filter(({info})=>info&&!info.completed&&info.days<=30)
    // Primero las que están por vencer (la más próxima arriba); después las ya vencidas (la más reciente arriba).
    .sort((a,b)=>followupRank(a.info.days)-followupRank(b.info.days));
  const overdue=rows.filter(r=>r.info.days<0).length,soon=rows.length-overdue;
  $('#followup-counts').innerHTML=rows.length?`${soon?`<span class="followup-count is-soon">${soon} por vencer</span>`:''}${overdue?`<span class="followup-count is-overdue">${overdue} vencida${overdue===1?'':'s'}</span>`:''}`:'';
  const day=iso=>new Intl.DateTimeFormat('es-CR',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(iso+'T12:00:00Z'));
  const badge=days=>days<0?`<span class="followup-badge is-overdue">${Math.abs(days)} días vencida</span>`:days===0?'<span class="followup-badge is-overdue">Vence hoy</span>':`<span class="followup-badge ${days<=10?'is-urgent':'is-soon'}">${days} días</span>`;
  list.innerHTML=rows.length?rows.slice(0,FOLLOWUP_SUMMARY_LIMIT).map(({watch,info})=>`<div class="followup-row"><div class="followup-name"><strong>${escapeHtml(watch.label||'Sin nombre')}</strong><small>${watch.case_number?`Caso ${escapeHtml(watch.case_number)} · `:''}Emitido ${escapeHtml(day(info.emittedDate))} · Meta ${escapeHtml(day(info.deadline))}</small></div>${badge(info.days)}<button type="button" class="followup-open" data-followup-open="${escapeHtml(watch.id)}">Abrir</button></div>`).join(''):'<div class="empty">No hay metas de formalización vencidas ni por vencer en los próximos 30 días.</div>';
  const hidden=rows.length-Math.min(rows.length,FOLLOWUP_SUMMARY_LIMIT);
  $('#followup-more').textContent=hidden?`y ${hidden} más en Reportes y alertas`:'';
  list.querySelectorAll('[data-followup-open]').forEach(button=>button.onclick=()=>openDetail(button.dataset.followupOpen));
  $('#followup-open-reports').onclick=()=>openAdminView('reports');
}

function renderActivity(){
  const now=new Date(),today=BonoCase.todayISO(now);
  const dayOf=value=>Number.isFinite(Date.parse(value))?BonoCase.todayISO(value):'';
  const isToday=value=>dayOf(value)===today;
  const eventsByDay=new Map(),alertsByDay=new Map();
  for(const event of events){
    const created=dayOf(event.created_at),sent=dayOf(event.sent_at);
    if(created)eventsByDay.set(created,(eventsByDay.get(created)||0)+1);
    if(sent)alertsByDay.set(sent,(alertsByDay.get(sent)||0)+1);
  }
  const dailyEvents=events.filter(event=>isToday(event.created_at));
  $('#summary-date').textContent=new Intl.DateTimeFormat('es-CR',{dateStyle:'full',timeZone:'America/Costa_Rica'}).format(now);
  $('#metric-reviewed-today').textContent=watches.filter(watch=>isToday(watch.last_success_at)).length;
  $('#metric-changes').textContent=dailyEvents.length;
  $('#metric-sent-today').textContent=alertsByDay.get(today)||0;
  renderSummaryCharts(today,eventsByDay,alertsByDay);
  // Últimos 7 días (incluye hoy). Los de hoy se resaltan y dicen "Hoy" en lugar de la fecha.
  const sinceDay=BonoCase.todayISO(new Date(now.getTime()-(RECENT_ACTIVITY_DAYS-1)*86400000));
  const recentEvents=events.filter(event=>{const day=dayOf(event.created_at);return day&&day>=sinceDay;});
  const range=paginationRange(activityPagination,recentEvents.length),pageEvents=recentEvents.slice(range.start,range.end);
  const timeOf=value=>new Intl.DateTimeFormat('es-CR',{timeStyle:'short',timeZone:'America/Costa_Rica'}).format(new Date(value));
  $('#activity-list').innerHTML=recentEvents.length?pageEvents.map(e=>{const w=watches.find(x=>x.id===e.watch_id),today=isToday(e.created_at);return `<div class="activity${today?' is-today':''}"><span class="activity-dot"></span><div class="activity-body"><p><strong>${escapeHtml(w?.label||'Expediente')}</strong> cambió de estado${w?.case_number?` <span class="activity-case">· Caso ${escapeHtml(w.case_number)}</span>`:''}</p>${activityTransition(e)}<small>${e.status==='sent'?'Correo enviado':e.status==='review_required'?'Requiere revisión':'Notificación pendiente'}</small></div>${today?`<small class="activity-when"><span class="activity-today">Hoy</span> · ${escapeHtml(timeOf(e.created_at))}</small>`:`<small class="activity-when">${escapeHtml(formatDate(e.created_at))}</small>`}</div>`}).join(''):`<div class="empty">No hay cambios registrados en los últimos ${RECENT_ACTIVITY_DAYS} días.</div>`;
  renderPagination('#activity-pagination',activityPagination,recentEvents.length,renderActivity,{label:'cambios recientes'});
}

// Muestra "estado anterior → estado actual" de un cambio detectado por el monitor.
function activityTransition(event){
  const hadState=Array.isArray(event.before_states)&&event.before_states.length;
  const before=hadState?latestState(event.before_states):'Sin estado previo';
  const after=latestState(event.after_states);
  return `<div class="activity-transition"><span class="state-chip is-before${hadState?'':' is-none'}" title="Estado anterior">${escapeHtml(before)}</span><span class="activity-arrow" aria-label="cambió a">→</span><span class="state-chip is-after" title="Estado actual">${escapeHtml(after)}</span></div>`;
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
    const summaryHeaders=[{label:'Nombre o referencia',key:'label',width:180},{label:'Cédula',key:'cedula',width:100},{label:'Caso BANHVI',key:'case',width:110},{label:'Monitoreo',key:'enabled',width:90},{label:'Estado BANHVI (consulta)',key:'state',width:220},{label:'Última revisión',key:'checked',width:150},{label:'Prioridad',key:'priority',width:90},{label:'Responsable',key:'assigned',width:140},{label:'Vencimiento',key:'due',width:130},{label:'Error reciente',key:'error',width:160},{label:'Acción pendiente',key:'action',width:180}];
    const summaryRows=watches.map(w=>({label:w.label||'',cedula:w.cedula,case:w.case_number||'',enabled:w.enabled?'Activo':'Pausado',state:latestState(w.last_states),checked:formatDate(w.last_success_at),priority:w.priority||'normal',assigned:w.assigned_to||'',due:w.due_at?formatDate(w.due_at):'',error:w.last_error==='CASE_SELECTION_REQUIRED'?'':w.last_error||'',action:w.last_error==='CASE_SELECTION_REQUIRED'?'Revisar o elegir caso BANHVI':''}));
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
  $('#detail-check-id').textContent=w.id;
  renderCaseChoices(w);
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
  message.textContent='Invitación programada. Se enviará automáticamente en la próxima revisión (7:17 a. m., 12:17 p. m. o 4:17 p. m.).';
}
async function addNote(event){event.preventDefault();const body=$('#note-body').value.trim();if(!body||!currentWatchId)return;const {error}=await client.from('monitor_notes').insert({watch_id:currentWatchId,body,client_visible:$('#note-visible').checked});if(error){toast('No se pudo guardar la nota');return;}event.target.reset();await loadData();renderCaseManagement();toast('Nota agregada');}
async function addTask(event){event.preventDefault();const title=$('#task-title').value.trim();if(!title||!currentWatchId)return;const {error}=await client.from('monitor_tasks').insert({watch_id:currentWatchId,title,due_at:$('#task-due').value?new Date($('#task-due').value).toISOString():null,assigned_to:$('#detail-assigned').value.trim()||null});if(error){toast('No se pudo crear la tarea');return;}event.target.reset();await loadData();renderCaseManagement();toast('Tarea creada');}
async function toggleTask(id,done){if(!canEditCases())return;const {error}=await client.from('monitor_tasks').update({completed_at:done?new Date().toISOString():null}).eq('id',id);if(error){toast('No se pudo actualizar la tarea');return;}await loadData();renderCaseManagement();}
async function uploadDocument(event){event.preventDefault();const file=$('#document-file').files[0];if(!file||!currentWatchId)return;if(file.size>10485760){toast('El archivo supera 10 MB');return;}const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=`${currentWatchId}/${crypto.randomUUID()}-${safe}`;const upload=await client.storage.from('monitor-documents').upload(path,file);if(upload.error){toast('No se pudo subir el documento');return;}const saved=await client.from('monitor_documents').insert({watch_id:currentWatchId,name:file.name,storage_path:path,client_visible:$('#document-visible').checked});if(saved.error){await client.storage.from('monitor-documents').remove([path]);toast('No se pudo registrar el documento');return;}event.target.reset();await loadData();renderCaseManagement();toast('Documento guardado');}


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
  const viewer=sessionUser?.id;
  const runLabel=$('#platform-monitor-run'), companies=$('#platform-monitor-companies');
  runLabel.textContent='Cargando estado del monitor…';
  companies.replaceChildren();
  const [organizations,members,invites,overview]=await Promise.all([readRows('monitor_organizations'),readRows('monitor_organization_members'),readRows('monitor_member_invites'),client.rpc('platform_monitor_overview')]);
  if(!isPlatformAdmin||sessionUser?.id!==viewer)return;
  const run=overview.data?.latest_run;
  if(overview.error)runLabel.textContent='Estado del monitor pendiente de activación.';
  else if(!run)runLabel.textContent='El historial aparecerá cuando termine el primer lote general con registro habilitado.';
  else{
    const remaining=run.selected-run.completed-run.technical_failures-run.unresolved;
    const result=run.timed_out?'Lote interrumpido por tiempo':run.failed?'Lote con incidencias':'Lote finalizado';
    runLabel.textContent=`${result} · ${formatDate(run.finished_at)}. ${run.selected} seleccionados, ${run.completed} completados, ${run.technical_failures} fallos técnicos, ${run.unresolved} sin resultado o por revisar y ${remaining} sin intentar. Fallos de envío: ${run.delivery_failures}.`;
  }
  for(const company of overview.data?.companies||[]){
    const group=document.createElement('section');
    group.className='monitor-health';
    const heading=document.createElement('h4');
    heading.textContent=company.name;
    const actions=document.createElement('div');
    actions.className='welcome-actions';
    for(const [key,filter] of [['unattempted','__unattempted'],['technical','__technical'],['review','__case_review']]){
      const button=document.createElement('button');
      button.type='button';button.className='ghost';
      button.textContent=`${monitorFilters[filter].label} · ${company[key]}`;
      button.onclick=async()=>{
        if(!isPlatformAdmin||!sessionOrganizations.some(o=>o.id===company.id&&o.active))return;
        await selectOrganization(company.id);
        if(isPlatformAdmin&&currentOrganization?.id===company.id)showMonitorFilter(filter);
      };
      actions.append(button);
    }
    group.append(heading,actions);
    companies.append(group);
  }
  renderMonitorControls();
  if(organizations.error||members.error||invites.error){toast('No se pudieron actualizar las empresas y accesos');return;}
  platformManager.render(organizations.data,members.data,invites.data);
}

// Control del monitor desde el superadmin (sql/platform_monitor_control.sql).
// Horario automático: lunes a sábado, 7:17, 12:17 y 16:17 (Costa Rica, UTC-6).
const MONITOR_SLOTS=[7*60+17,12*60+17,16*60+17];
function nextMonitorSlot(now=new Date()){
  const crNow=new Date(now.getTime()-6*3600000);
  for(let day=0;day<8;day++){
    const base=Date.UTC(crNow.getUTCFullYear(),crNow.getUTCMonth(),crNow.getUTCDate()+day);
    if(new Date(base).getUTCDay()===0)continue;
    for(const minute of MONITOR_SLOTS){
      const slot=new Date(base+(minute+360)*60000);
      if(slot>now)return slot;
    }
  }
  return null;
}
function monitorSlotLabel(slot){
  if(!slot)return '';
  const tz={timeZone:'America/Costa_Rica'};
  const day=d=>new Intl.DateTimeFormat('en-CA',{...tz,dateStyle:'short'}).format(d);
  const time=new Intl.DateTimeFormat('es-CR',{...tz,hour:'numeric',minute:'2-digit'}).format(slot);
  const now=new Date(),tomorrow=new Date(now.getTime()+86400000);
  const when=day(slot)===day(now)?'hoy':day(slot)===day(tomorrow)?'mañana':new Intl.DateTimeFormat('es-CR',{...tz,weekday:'long'}).format(slot);
  return `${when} a las ${time}`;
}
let monitorPauseArmed=null;
async function renderMonitorControls(){
  const label=$('#platform-monitor-schedule'),note=$('#platform-monitor-note'),runNow=$('#platform-monitor-run-now'),toggle=$('#platform-monitor-toggle');
  if(!label||!isPlatformAdmin)return;
  const {data,error}=await client.rpc('platform_monitor_schedule');
  if(!isPlatformAdmin)return;
  runNow.hidden=toggle.hidden=true;
  if(error){label.textContent='Para controlar el monitor desde aquí falta instalar sql/platform_monitor_control.sql en Supabase.';return;}
  if(!data?.jobs){label.textContent='El horario automático no está instalado (sql/monitor_dispatch_cron.sql).';return;}
  const active=data.active===data.jobs;
  const last=data.last_dispatch?` · Último disparo automático: ${formatDate(data.last_dispatch)}`:'';
  label.innerHTML=active
    ?`<span class="monitor-state is-on">Automático: activo</span> Próxima revisión: ${escapeHtml(monitorSlotLabel(nextMonitorSlot()))}${escapeHtml(last)}`
    :`<span class="monitor-state is-off">Automático: en pausa</span> No se consulta el BANHVI hasta que lo reanudés${escapeHtml(last)}`;
  if(!data.token)note.textContent='Falta el token de GitHub en Vault: los disparos no van a funcionar.';
  runNow.hidden=!data.token;toggle.hidden=false;
  toggle.textContent=active?'Pausar revisiones automáticas':'Reanudar revisiones automáticas';
  toggle.className=active?'ghost':'primary';
  monitorPauseArmed=null;
  toggle.onclick=async()=>{
    if(active&&monitorPauseArmed!==toggle){
      monitorPauseArmed=toggle;toggle.textContent='¿Seguro? Tocá otra vez para pausar';
      setTimeout(()=>{if(monitorPauseArmed===toggle){monitorPauseArmed=null;toggle.textContent='Pausar revisiones automáticas';}},5000);
      return;
    }
    toggle.disabled=true;
    const result=await client.rpc('platform_set_monitor_schedule',{p_active:!active});
    toggle.disabled=false;
    note.textContent=result.error?`No se pudo cambiar: ${result.error.message}`:active?'Revisiones automáticas en pausa.':'Revisiones automáticas reanudadas.';
    if(!result.error)renderMonitorControls();
  };
  runNow.onclick=async()=>{
    runNow.disabled=true;note.textContent='Pidiendo la revisión…';
    const result=await client.rpc('platform_run_monitor_now');
    runNow.disabled=false;
    note.textContent=result.error?`No se pudo iniciar: ${result.error.message}`:'Listo: la revisión arranca en unos segundos. El estado de arriba se actualiza cuando termine (unos 15 minutos).';
  };
}
async function openAdminView(view){
  if(view==='platform'&&!isPlatformAdmin)return;
  currentAdminView=view;
  $('#admin-summary').classList.toggle('hidden',view!=='summary'||!currentOrganization);
  $('#admin-cases').classList.toggle('hidden',view!=='cases'||!currentOrganization);
  $('#admin-reports').classList.toggle('hidden',view!=='reports'||!currentOrganization);
  $('#platform-admin').classList.toggle('hidden',view!=='platform');
  $('#platform-monitor').classList.toggle('hidden',view!=='platform'||!isPlatformAdmin);
  document.querySelectorAll('[data-admin-view]').forEach(button=>{const selected=button.dataset.adminView===view;button.classList.toggle('selected',selected);if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  if(view==='platform')await loadPlatform();else if(view==='reports')operationsReports.render();else if(view==='summary'){renderActivity();renderFollowupSummary();}
  window.scrollTo(0,0);
}
function clearCompanyData(){
  consultationBaselineReady=false;dismissedConsultations='';pendingConsultations='';
  $('#consultation-refresh').classList.add('hidden');
  watchPagination.page=1;watchPagination.pageSize=10;watchPagination.criteria='';activityPagination.page=1;activityPagination.pageSize=10;
  loadSequence++;watches=[];events=[];checkRequests=[];caseChoices=[];notes=[];tasks=[];documents=[];caseProfiles=[];consents=[];privacyRequests=[];auditEvents=[];currentWatchId=null;intakeAvailable=false;workbookImporter.invalidate();
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

$('#login-form').addEventListener('submit',signIn);$('#reset-password-btn').onclick=requestPasswordReset;$('#magic-link-btn').onclick=()=>requestMagicLink(false);$('#activate-access-btn').onclick=()=>requestMagicLink(true);$('#organization-picker').onchange=event=>selectOrganization(event.target.value);$('#password-form').addEventListener('submit',saveNewPassword); $('#add-form').addEventListener('submit',addWatch); $('#open-add').onclick=()=>$('#add-dialog').showModal(); $('#close-add').onclick=$('#cancel-add').onclick=()=>$('#add-dialog').close(); $('#close-detail').onclick=()=>$('#detail-dialog').close(); $('#refresh-btn').onclick=()=>currentAdminView==='platform'?loadPlatform():loadData(); $('#logout-btn').onclick=signOutPanel; $('#search').addEventListener('input',e=>renderWatches(e.target.value));
$('#accept-consultation-refresh').onclick=()=>loadData();
$('#defer-consultation-refresh').onclick=()=>{
  dismissedConsultations=pendingConsultations;
  $('#consultation-refresh').classList.add('hidden');
};
$('#export-btn').onclick=exportExcel;
['#status-filter','#priority-filter','#deadline-filter','#modality-filter','#stage-filter','#case-sort'].forEach(selector=>$(selector).onchange=()=>renderWatches($('#search').value));
const isFormalizedFilter=()=>/^FORMALIZAD[OA]$/i.test($('#official-status-filter').value);
$('#emitted-filter').onchange=()=>{
  if($('#emitted-filter').value==='pending'&&isFormalizedFilter())$('#official-status-filter').value='';
  renderWatches($('#search').value);
};
$('#official-status-filter').onchange=()=>{
  if(isFormalizedFilter()){
    if($('#emitted-filter').value==='pending')$('#emitted-filter').value='';
    $('#deadline-filter').value='';
  }
  renderWatches($('#search').value);
};
function showMonitorFilter(filter){
  $('#search').value='';
  ['#status-filter','#priority-filter','#emitted-filter','#deadline-filter','#modality-filter','#stage-filter'].forEach(selector=>$(selector).value='');
  $('#official-status-filter').value=filter;
  renderWatches();
  void openAdminView('cases');
}
document.querySelectorAll('[data-monitor-filter]').forEach(button=>button.onclick=()=>showMonitorFilter(button.dataset.monitorFilter));
$('#new-modality').innerHTML=BonoCase.modalities.map(m=>`<option value="${m.id}">${escapeHtml(m.label)}</option>`).join('');
$('#modality-filter').innerHTML='<option value="">Todas las modalidades</option>'+$('#new-modality').innerHTML;
$('#stage-filter').innerHTML='<option value="">Todas las etapas internas</option>'+BonoCase.stages.map(s=>`<option value="${s.id}">Gestión interna: ${escapeHtml(s.label)}</option>`).join('');
$('#client-education').innerHTML=BonoReports.educationHtml();
const adminMenuToggle=$('#admin-menu-toggle');
function setAdminMenu(open){
  adminMenuToggle.setAttribute('aria-expanded',String(open));
  $('#admin-sidebar').classList.toggle('menu-open',open);
}
adminMenuToggle.onclick=()=>setAdminMenu(adminMenuToggle.getAttribute('aria-expanded')!=='true');
appView.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&adminMenuToggle.offsetWidth&&adminMenuToggle.getAttribute('aria-expanded')==='true'){
    setAdminMenu(false);
    adminMenuToggle.focus();
  }
});
document.querySelectorAll('[data-admin-view]').forEach(button=>button.onclick=()=>{
  if(adminMenuToggle.offsetWidth){
    setAdminMenu(false);
    adminMenuToggle.focus();
  }
  openAdminView(button.dataset.adminView);
});
$('#print-case').onclick=()=>{const w=watches.find(w=>w.id===currentWatchId);if(w)BonoReports.printCase(w,profileFor(w)||{},notes,documents,tasks);};
$('#import-btn').onclick=()=>$('#import-file').click();$('#import-file').onchange=event=>{const file=event.target.files[0];if(file)workbookImporter.open(file);event.target.value='';};
$('#save-management').onclick=saveManagement;$('#send-client-access').onclick=sendClientAccess;$('#note-form').addEventListener('submit',addNote);$('#task-form').addEventListener('submit',addTask);$('#document-form').addEventListener('submit',uploadDocument);
$('#open-client-preview').onclick=openClientPreview;$('#close-client-preview').onclick=closeClientPreview;
const routeParams=new URLSearchParams(location.search);
const clientMode=Boolean(routeParams.get('cliente'));
const adminMode=routeParams.get('admin')==='1';
if(adminMode&&!clientMode){
  const themeButton=$('#theme-btn');
  function setAdminTheme(dark){
    document.documentElement.classList.toggle('admin-dark',dark);
    themeButton.setAttribute('aria-pressed',String(dark));
    themeButton.title=dark?'Activar modo claro':'Activar modo oscuro';
  }
  setAdminTheme(localStorage.getItem('bonoalerta-admin-theme')!=='light');
  themeButton.onclick=()=>{
    const dark=!document.documentElement.classList.contains('admin-dark');
    setAdminTheme(dark);
    localStorage.setItem('bonoalerta-admin-theme',dark?'dark':'light');
  };
}
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
else if(adminMode){setInterval(checkForConsultationResults,60_000);landingView.classList.add('hidden');loginView.classList.remove('hidden');client.auth.onAuthStateChange((event,session)=>{
  if(event==='PASSWORD_RECOVERY'){passwordRecoveryMode=true;setTimeout(()=>openPasswordDialog(session,'recovery'),0);return;}
  if(activationMode&&event==='SIGNED_IN'&&initialActivation.verifiedCallback){
    const expectedEmail=sessionStorage.getItem('bonoalerta-activation');
    if(expectedEmail&&session?.user?.email?.toLowerCase()!==expectedEmail){
      activationVerificationAccepted=false;passwordOwner=null;setTimeout(()=>{$('#password-dialog').close();loginView.classList.remove('hidden');appView.classList.add('hidden');$('#login-message').textContent='El enlace corresponde a otro correo. Solicitá uno nuevo para el correo que querés activar.';$('#login-message').className='message error';},0);return;
    }
    activationVerificationAccepted=true;
  }
  if(!activationMode&&!passwordRecoveryMode&&session?.user?.id===sessionUser?.id&&sessionUser&&
    (event==='SIGNED_IN'||event==='TOKEN_REFRESHED'))return;
  setTimeout(()=>showSession(session),0);
});client.auth.getSession().then(({data})=>showSession(data.session));}
else{loginView.classList.add('hidden');appView.classList.add('hidden');landingView.classList.remove('hidden');}
})();
