const SUPABASE_URL = 'https://vhdygrooeipxibnpofxf.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_I4uK-zm16tOepB_N2TzXqg_WlVd22QB';
const ADMIN_EMAIL_SHA256 = '79889154e949530891ecb34df7e6b3b4f9acb51f43958bb4e86f9821260b4cc8';
const client = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const $ = (selector) => document.querySelector(selector);
const loginView = $('#login-view');
const appView = $('#app-view');
let watches = [];
let events = [];

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
  render();
  $('#sync-status').innerHTML='<i></i> Sincronizado';
}

function render() {
  $('#metric-total').textContent=watches.length;
  $('#metric-active').textContent=watches.filter(w=>w.enabled).length;
  $('#metric-changes').textContent=events.length;
  $('#metric-errors').textContent=watches.filter(w=>w.last_error).length;
  renderWatches($('#search').value);
  renderActivity();
}

function renderWatches(query='') {
  const q=query.trim().toLowerCase();
  const rows=watches.filter(w=>[w.label,w.cedula,w.case_number].some(v=>String(v||'').toLowerCase().includes(q)));
  $('#watch-list').innerHTML=rows.length?rows.map(w=>`<article class="watch-row">
    <div class="watch-name"><div class="watch-icon">${escapeHtml((w.label||'E').slice(0,1).toUpperCase())}</div><div><strong>${escapeHtml(w.label||'Sin nombre')}</strong><small>Cédula ${escapeHtml(w.cedula)}</small></div></div>
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
function openDetail(id){const w=watches.find(x=>x.id===id);if(!w)return;$('#detail-title').textContent=w.label||'Expediente';$('#detail-meta').innerHTML=`<span>Cédula ${escapeHtml(w.cedula)}</span><span>${w.case_number?`Caso #${escapeHtml(w.case_number)}`:'Caso pendiente'}</span><span>${w.enabled?'Activo':'Pausado'}</span>`;const states=Array.isArray(w.last_states)?[...w.last_states].reverse():[];$('#state-list').innerHTML=states.length?states.map(s=>`<div class="state"><time>${escapeHtml(s.date)}</time><strong>${escapeHtml(s.description)}</strong></div>`).join(''):'<div class="empty">La primera revisión todavía no se ha completado.</div>';$('#detail-dialog').showModal();}

async function showSession(session){ if(!session){loginView.classList.remove('hidden');appView.classList.add('hidden');return;}if(!await isAdmin(session.user.email)){await client.auth.signOut();$('#login-message').textContent='Este usuario no está autorizado.';return;}loginView.classList.add('hidden');appView.classList.remove('hidden');await loadData();}

$('#login-form').addEventListener('submit',signIn); $('#add-form').addEventListener('submit',addWatch); $('#open-add').onclick=()=>$('#add-dialog').showModal(); $('#close-add').onclick=$('#cancel-add').onclick=()=>$('#add-dialog').close(); $('#close-detail').onclick=()=>$('#detail-dialog').close(); $('#refresh-btn').onclick=loadData; $('#logout-btn').onclick=()=>client.auth.signOut(); $('#search').addEventListener('input',e=>renderWatches(e.target.value));
$('#export-btn').onclick=exportExcel;
client.auth.onAuthStateChange((_event,session)=>setTimeout(()=>showSession(session),0));
client.auth.getSession().then(({data})=>showSession(data.session));
