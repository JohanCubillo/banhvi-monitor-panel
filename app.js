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
    const workbook=new ExcelJS.Workbook();workbook.creator='Monitor BANHVI';workbook.created=new Date();
    const configure=(sheet,columns)=>{sheet.columns=columns;sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:`${String.fromCharCode(64+columns.length)}1`};sheet.getRow(1).height=24;sheet.getRow(1).eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF0B3B47'}};cell.alignment={vertical:'middle'};});};
    const summary=workbook.addWorksheet('Expedientes');
    configure(summary,[{header:'Nombre o referencia',key:'label',width:28},{header:'Cédula',key:'cedula',width:16},{header:'Caso BANHVI',key:'case',width:17},{header:'Monitoreo',key:'enabled',width:14},{header:'Estado actual',key:'state',width:34},{header:'Última revisión',key:'checked',width:22},{header:'Versión',key:'version',width:11},{header:'Error reciente',key:'error',width:22}]);
    watches.forEach(w=>summary.addRow({label:w.label||'',cedula:w.cedula,case:w.case_number||'',enabled:w.enabled?'Activo':'Pausado',state:latestState(w.last_states),checked:w.last_success_at?new Date(w.last_success_at):null,version:w.version,error:w.last_error||''}));
    summary.getColumn('cedula').numFmt='@';summary.getColumn('case').numFmt='@';summary.getColumn('checked').numFmt='dd/mm/yyyy hh:mm';
    const states=workbook.addWorksheet('Estados');
    configure(states,[{header:'Nombre o referencia',key:'label',width:28},{header:'Cédula',key:'cedula',width:16},{header:'Caso BANHVI',key:'case',width:17},{header:'Fecha del estado',key:'date',width:18},{header:'Descripción',key:'description',width:48}]);
    watches.forEach(w=>(w.last_states||[]).forEach(s=>states.addRow({label:w.label||'',cedula:w.cedula,case:w.case_number||'',date:s.date,description:s.description})));states.getColumn('cedula').numFmt='@';states.getColumn('case').numFmt='@';
    const changes=workbook.addWorksheet('Cambios');
    configure(changes,[{header:'Nombre o referencia',key:'label',width:28},{header:'Cédula',key:'cedula',width:16},{header:'Caso BANHVI',key:'case',width:17},{header:'Detectado',key:'created',width:22},{header:'Notificación',key:'status',width:20},{header:'Correo enviado',key:'sent',width:22},{header:'Estados agregados',key:'added',width:48},{header:'Estados eliminados',key:'removed',width:48}]);
    events.forEach(e=>{const w=watches.find(x=>x.id===e.watch_id)||{},diff=stateDifference(e.before_states,e.after_states);changes.addRow({label:w.label||'',cedula:w.cedula||'',case:w.case_number||'',created:new Date(e.created_at),status:e.status==='sent'?'Enviada':e.status==='review_required'?'Requiere revisión':'Pendiente',sent:e.sent_at?new Date(e.sent_at):null,added:diff.added,removed:diff.removed});});
    changes.getColumn('cedula').numFmt='@';changes.getColumn('case').numFmt='@';changes.getColumn('created').numFmt='dd/mm/yyyy hh:mm';changes.getColumn('sent').numFmt='dd/mm/yyyy hh:mm';
    [summary,states,changes].forEach(sheet=>sheet.eachRow((row,n)=>{if(n>1&&n%2===0)row.eachCell(cell=>cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF1F7F4'}});row.alignment={vertical:'top',wrapText:true};}));
    const buffer=await workbook.xlsx.writeBuffer(),url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const link=document.createElement('a');link.href=url;link.download=`monitor-banhvi-${new Date().toISOString().slice(0,10)}.xlsx`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Excel descargado');
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

