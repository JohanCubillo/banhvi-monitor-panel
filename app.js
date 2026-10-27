const SUPABASE_URL = 'https://vhdygrooeipxibnpofxf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_I4uK-zm16tOepB_N2TzXqg_WlVd22QB';
const ADMIN_EMAIL_SHA256 = '79889154e949530891ecb34df7e6b3b4f9acb51f43958bb4e86f9821260b4cc8';
const client = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = (selector) => document.querySelector(selector);
const loginView = $('#login-view');
const appView = $('#app-view');
let watches = [];
let events = [];
let notes = [];
let tasks = [];
let documents = [];
let currentWatchId = null;

function trafficStatus(watch){
  if(watch.last_error)return 'red';
  if(watch.due_at){const hours=(new Date(watch.due_at)-Date.now())/36e5;if(hours<0)return 'red';if(hours<72)return 'yellow';}
  if(watch.last_success_at&&(Date.now()-new Date(watch.last_success_at))/864e5>3)return 'yellow';
  return 'green';
}
function formalizationInfo(states=[]){
  const emitted=(states||[]).filter(s=>String(s.description||'').trim().toUpperCase()==='EMITIDO').sort((a,b)=>{const [da,ma,ya]=a.date.split('/').map(Number),[db,mb,yb]=b.date.split('/').map(Number);return new Date(yb,mb-1,db)-new Date(ya,ma-1,da);})[0];
  if(!emitted)return null;const [d,m,y]=emitted.date.split('/').map(Number),start=new Date(y,m-1,d),deadline=new Date(start);deadline.setDate(deadline.getDate()+90);const today=new Date();today.setHours(0,0,0,0);return{date:deadline,days:Math.ceil((deadline-today)/864e5)};
}
function formalizationHtml(states){const info=formalizationInfo(states);if(!info)return'';const date=new Intl.DateTimeFormat('es-CR',{dateStyle:'long'}).format(info.date),text=info.days<0?`Plazo de formalización vencido hace ${Math.abs(info.days)} días`:info.days===0?'El plazo de formalización vence hoy':`Faltan ${info.days} días para completar 90 días desde EMITIDO`;return`<span class="deadline-alert ${info.days<=5?'urgent':''}">${escapeHtml(text)} · ${escapeHtml(date)}</span>`;}

function formatDate(value) {
  if (!value) return 'Aún no revisado';
  return new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Costa_Rica' }).format(new Date(value));
}
function escapeHtml(value='') { const div=document.createElement('div'); div.textContent=String(value); return div.innerHTML; }
async function isAdmin(email='') { const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email.trim().toLowerCase())); return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('')===ADMIN_EMAIL_SHA256; }
function latestState(states) {
  if (!Array.isArray(states) || !states.length) return 'Pendiente de primera revisión';
  return [...states].sort((a,b) => { const [da,ma,ya]=a.date.split('/').map(Number),[db,mb,yb]=b.date.split('/').map(Number); return new Date(yb,mb-1,db)-new Date(ya,ma-1,da); })[0].description;
}
function toast(text){ const el=$('#toast'); el.textContent=text; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2600); }

async function signIn(event) {
  event.preventDefault();
  const email = $('#email').value.trim().toLowerCase();
  const message = $('#login-message');
  if (!await isAdmin(email)) { message.textContent='Este correo no está autorizado.'; message.className='message error'; return; }
  message.textContent='Enviando enlace seguro…'; message.className='message';
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } });
  if (error) { message.textContent='No se pudo enviar el enlace. Intentá nuevamente.'; message.className='message error'; return; }
  message.textContent='Listo. Revisá tu correo y abrí el enlace de acceso.';
}

async function loadData() {
  $('#sync-status').innerHTML='<i></i> Actualizando…';
  const [watchResult,eventResult] = await Promise.all([
    client.from('monitor_watches').select('*').order('created_at',{ascending:false}),
    client.from('monitor_outbox').select('id,watch_id,status,created_at,sent_at,before_states,after_states').order('created_at',{ascending:false})
  ]);
  if (watchResult.error || eventResult.error) { toast('No fue posible cargar los datos'); return; }
  watches=watchResult.data||[]; events=eventResult.data||[];
  const [noteResult,taskResult,documentResult]=await Promise.all([
    client.from('monitor_notes').select('*').order('created_at',{ascending:false}),
    client.from('monitor_tasks').select('*').order('created_at',{ascending:false}),
    client.from('monitor_documents').select('*').order('created_at',{ascending:false})
  ]);
  notes=noteResult.data||[];tasks=taskResult.data||[];documents=documentResult.data||[];
  render();
  $('#sync-status').innerHTML='<i></i> Sincronizado';
}

function render() {
  $('#metric-total').textContent=watches.length;
  $('#metric-active').textContent=watches.filter(w=>w.enabled).length;
  $('#metric-changes').textContent=events.length;
  $('#metric-errors').textContent=watches.filter(w=>trafficStatus(w)==='red').length;
  renderWatches($('#search').value);
  renderActivity();
}

function renderWatches(query='') {
  const q=query.trim().toLowerCase();
  const status=$('#status-filter')?.value||'',priority=$('#priority-filter')?.value||'';
  const rows=watches.filter(w=>[w.label,w.cedula,w.case_number,w.assigned_to].some(v=>String(v||'').toLowerCase().includes(q))).filter(w=>!status||trafficStatus(w)===status).filter(w=>!priority||w.priority===priority);
  $('#watch-list').innerHTML=rows.length?rows.map(w=>`<article class="watch-row ${trafficStatus(w)==='red'?'attention':trafficStatus(w)==='yellow'?'near-due':''}">
    <div class="watch-name"><div class="watch-icon">${escapeHtml((w.label||'E').slice(0,1).toUpperCase())}</div><div><strong><span class="traffic ${trafficStatus(w)}"></span>${escapeHtml(w.label||'Sin nombre')}</strong><small>Cédula ${escapeHtml(w.cedula)}</small><span class="priority">${escapeHtml(w.priority||'normal')} · ${escapeHtml(w.assigned_to||'Sin responsable')}</span></div></div>
    <div class="cell"><span class="cell-label">Caso BANHVI</span><strong>${w.case_number?`#${escapeHtml(w.case_number)}`:'Pendiente'}</strong></div>
    <div class="cell"><span class="cell-label">Estado actual</span><strong>${escapeHtml(latestState(w.last_states))}</strong><small>${escapeHtml(formatDate(w.last_success_at))}</small></div>
    <div><span class="badge ${w.last_error?'error':w.enabled?'':'paused'}">${w.last_error?'Revisar':w.enabled?'Activo':'Pausado'}</span></div>
    <div class="row-actions"><button data-detail="${w.id}" title="Ver estados">Ver</button><button data-toggle="${w.id}" title="${w.enabled?'Pausar':'Activar'}">${w.enabled?'Pausar':'Activar'}</button></div>
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
    const link=document.createElement('a');link.href=url;link.download=`monitor-banhvi-${new Date().toISOString().slice(0,10)}.xls`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('Excel descargado');
  }catch(error){console.error(error);toast('No fue posible generar el Excel');}
  finally{button.disabled=false;button.textContent='Exportar a Excel';}
}

async function addWatch(event){
  event.preventDefault(); const cedula=$('#cedula').value.trim(),label=$('#label').value.trim(),message=$('#add-message');
  if(!/^\d{9,12}$/.test(cedula)){message.textContent='Ingresá una cédula de 9 a 12 dígitos.';message.className='message error';return;}
  const {error}=await client.from('monitor_watches').insert({cedula,label,enabled:true});
  if(error){message.textContent=error.code==='23505'?'Esa cédula ya está registrada.':'No se pudo guardar el expediente.';message.className='message error';return;}
  $('#add-dialog').close(); $('#add-form').reset(); toast('Expediente agregado'); await loadData();
}
async function toggleWatch(id){ const watch=watches.find(w=>w.id===id); if(!watch)return; const {error}=await client.from('monitor_watches').update({enabled:!watch.enabled}).eq('id',id); if(error){toast('No se pudo cambiar el monitoreo');return;} toast(watch.enabled?'Monitoreo pausado':'Monitoreo activado');await loadData(); }
function openDetail(id){
  const w=watches.find(x=>x.id===id);if(!w)return;currentWatchId=id;
  $('#detail-title').textContent=w.label||'Expediente';
  $('#detail-meta').innerHTML=`<span><i class="traffic ${trafficStatus(w)}"></i>Cédula ${escapeHtml(w.cedula)}</span><span>${w.case_number?`Caso #${escapeHtml(w.case_number)}`:'Caso pendiente'}</span><span>${w.enabled?'Activo':'Pausado'}</span>`;
  $('#internal-deadline').innerHTML=formalizationHtml(w.last_states);
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
  document.querySelectorAll('[data-task]').forEach(el=>el.onchange=()=>toggleTask(el.dataset.task,el.checked));
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
async function addNote(event){event.preventDefault();const body=$('#note-body').value.trim();if(!body||!currentWatchId)return;const {error}=await client.from('monitor_notes').insert({watch_id:currentWatchId,body,client_visible:$('#note-visible').checked});if(error){toast('No se pudo guardar la nota');return;}event.target.reset();await loadData();renderCaseManagement();toast('Nota agregada');}
async function addTask(event){event.preventDefault();const title=$('#task-title').value.trim();if(!title||!currentWatchId)return;const {error}=await client.from('monitor_tasks').insert({watch_id:currentWatchId,title,due_at:$('#task-due').value?new Date($('#task-due').value).toISOString():null,assigned_to:$('#detail-assigned').value.trim()||null});if(error){toast('No se pudo crear la tarea');return;}event.target.reset();await loadData();renderCaseManagement();toast('Tarea creada');}
async function toggleTask(id,done){const {error}=await client.from('monitor_tasks').update({completed_at:done?new Date().toISOString():null}).eq('id',id);if(error){toast('No se pudo actualizar la tarea');return;}await loadData();renderCaseManagement();}
async function uploadDocument(event){event.preventDefault();const file=$('#document-file').files[0];if(!file||!currentWatchId)return;if(file.size>10485760){toast('El archivo supera 10 MB');return;}const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=`${currentWatchId}/${crypto.randomUUID()}-${safe}`;const upload=await client.storage.from('monitor-documents').upload(path,file);if(upload.error){toast('No se pudo subir el documento');return;}const saved=await client.from('monitor_documents').insert({watch_id:currentWatchId,name:file.name,storage_path:path,client_visible:$('#document-visible').checked});if(saved.error){await client.storage.from('monitor-documents').remove([path]);toast('No se pudo registrar el documento');return;}event.target.reset();await loadData();renderCaseManagement();toast('Documento guardado');}

async function importCsv(file){
  const text=await file.text(),lines=text.replace(/^\ufeff/,'').split(/\r?\n/).filter(Boolean);if(!lines.length)return;
  const delimiter=lines[0].includes(';')?';':',';const header=lines[0].split(delimiter).map(v=>v.trim().toLowerCase());const cIndex=header.findIndex(v=>v.includes('cedula')||v.includes('cédula')),lIndex=header.findIndex(v=>v.includes('nombre')||v.includes('referencia'));
  if(cIndex<0){toast('El CSV necesita una columna cédula');return;}const rows=lines.slice(1).map(line=>line.split(delimiter)).map(cols=>({cedula:(cols[cIndex]||'').replace(/\D/g,''),label:(cols[lIndex]||'Expediente importado').trim(),enabled:true})).filter(r=>/^\d{9,12}$/.test(r.cedula));if(!rows.length){toast('No se encontraron cédulas válidas');return;}
  const {error}=await client.from('monitor_watches').upsert(rows,{onConflict:'cedula',ignoreDuplicates:true});if(error){toast('No se pudo importar el archivo');return;}toast(`${rows.length} filas procesadas`);await loadData();
}

async function searchClientCase(event){
  event.preventDefault();const cedula=$('#client-cedula').value.replace(/\D/g,''),caseNumber=$('#client-case').value.replace(/\D/g,''),message=$('#client-search-message');message.textContent='Consultando…';
  const {data,error}=await client.rpc('lookup_client_case',{p_cedula:cedula,p_case_number:caseNumber});if(error||!data){message.textContent='No encontramos un expediente habilitado con esos datos.';message.className='message error';return;}
  message.textContent='';message.className='message';$('#client-search-panel').classList.add('hidden');$('#client-result').classList.remove('hidden');$('#public-client-title').textContent=data.label||'Su expediente';$('#public-client-updated').textContent=`Última actualización: ${formatDate(data.last_success_at)}`;$('#public-client-status').innerHTML=escapeHtml(latestState(data.last_states));
  const states=Array.isArray(data.last_states)?[...data.last_states].reverse():[];$('#public-client-states').innerHTML=states.length?states.map(s=>`<div class="state"><time>${escapeHtml(s.date)}</time><strong>${escapeHtml(s.description)}</strong></div>`).join(''):'<div class="empty">Aún no hay estados disponibles.</div>';$('#public-client-notes').innerHTML=(data.notes||[]).length?data.notes.map(n=>`<div class="mini-item"><p>${escapeHtml(n.body)}</p><small>${formatDate(n.created_at)}</small></div>`).join(''):'<div class="empty">No hay información adicional compartida.</div>';$('#public-client-documents').innerHTML=(data.documents||[]).length?data.documents.map(d=>`<div class="mini-item"><strong>${escapeHtml(d.name)}</strong></div>`).join(''):'<div class="empty">No hay documentos compartidos.</div>';
}

async function showSession(session){ if(!session){loginView.classList.remove('hidden');appView.classList.add('hidden');return;}if(!await isAdmin(session.user.email)){await client.auth.signOut();$('#login-message').textContent='Este usuario no está autorizado.';return;}loginView.classList.add('hidden');appView.classList.remove('hidden');await loadData();}

$('#login-form').addEventListener('submit',signIn); $('#add-form').addEventListener('submit',addWatch); $('#open-add').onclick=()=>$('#add-dialog').showModal(); $('#close-add').onclick=$('#cancel-add').onclick=()=>$('#add-dialog').close(); $('#close-detail').onclick=()=>$('#detail-dialog').close(); $('#refresh-btn').onclick=loadData; $('#logout-btn').onclick=()=>client.auth.signOut(); $('#search').addEventListener('input',e=>renderWatches(e.target.value));
$('#export-btn').onclick=exportExcel;
$('#status-filter').onchange=()=>renderWatches($('#search').value);$('#priority-filter').onchange=()=>renderWatches($('#search').value);
$('#import-btn').onclick=()=>$('#import-file').click();$('#import-file').onchange=event=>{const file=event.target.files[0];if(file)importCsv(file);event.target.value='';};
$('#save-management').onclick=saveManagement;$('#note-form').addEventListener('submit',addNote);$('#task-form').addEventListener('submit',addTask);$('#document-form').addEventListener('submit',uploadDocument);
$('#open-client-preview').onclick=openClientPreview;$('#close-client-preview').onclick=closeClientPreview;
const clientMode=new URLSearchParams(location.search).get('cliente')==='1';
if(clientMode){loginView.classList.add('hidden');appView.classList.add('hidden');$('#client-public-view').classList.remove('hidden');$('#client-search-form').addEventListener('submit',searchClientCase);$('#client-new-search').onclick=()=>{$('#client-result').classList.add('hidden');$('#client-search-panel').classList.remove('hidden');$('#client-search-form').reset();};}
else{client.auth.onAuthStateChange((_event,session)=>setTimeout(()=>showSession(session),0));client.auth.getSession().then(({data})=>showSession(data.session));}
