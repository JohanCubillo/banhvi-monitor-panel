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
    client.from('monitor_outbox').select('id,watch_id,status,created_at,sent_at,before_states,after_states').order('created_at',{ascending:false}).limit(20)
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
client.auth.onAuthStateChange((_event,session)=>setTimeout(()=>showSession(session),0));
client.auth.getSession().then(({data})=>showSession(data.session));

