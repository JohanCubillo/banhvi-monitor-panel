(function (scope) {
  'use strict';
  const html = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const plans = [{id:'founder',label:'Fundador'},{id:'basic',label:'Inicio'},{id:'professional',label:'Equipo'},{id:'business',label:'Empresa'}];
  const roles = [{id:'owner',label:'Propietario'},{id:'admin',label:'Administrador'},{id:'agent',label:'Asesor'},{id:'viewer',label:'Consulta'}];
  const statusLabels = {pending:'En cola',sent:'Enviada',failed:'No enviada',review_required:'Revisar entrega'};
  const options = (list, selected) => list.map(item => `<option value="${html(item.id)}" ${item.id === selected ? 'selected' : ''}>${html(item.label)}</option>`).join('');
  const dateLabel = value => value ? new Intl.DateTimeFormat('es-CR',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Costa_Rica'}).format(new Date(value)) : '—';
  const slugify = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);

  function mount({container, client, getContext, onChanged = async () => {}, toast = () => {}}) {
    if(typeof container === 'string')container=document.querySelector(container);
    if(!container)throw new Error('Falta el contenedor de administración de empresas');
    let organizations=[],members=[],invites=[],selectedId=null,memberEdit=null,suspensionId=null,busy=false,slugManual=false;
    let createDraft={name:'',slug:'',admin_email:'',admin_name:'',plan:'basic',max_cases:20};
    let memberDraft={email:'',display_name:'',role:'admin',active:true};
    const context = () => getContext?.() || {};
    const allowed = () => context().isPlatformAdmin === true;
    const selectedOrganization = () => organizations.find(item => item.id === selectedId);
    const memberList = id => members.filter(item => item.organization_id === id);
    const orgInvites = id => invites.filter(item => item.organization_id === id).slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
    const activationUrl = org => `${location.origin}${location.pathname}?admin=1&activar=1&empresa=${encodeURIComponent(org.slug)}`;
    const latestInvite = (id,email) => orgInvites(id).find(item => (item.email || '').toLowerCase() === email.toLowerCase());
    const field = (label,name,value,type='text',extra='') => `<label class="bp-field"><span>${label}</span><input name="${name}" value="${html(value)}" type="${type}" ${extra}></label>`;
    function captureCreate() {
      const form=container.querySelector('[data-bp-form="create"]');if(!form)return;
      createDraft=Object.fromEntries(new FormData(form));
    }
    function captureMember() {
      const form=container.querySelector('[data-bp-form="member"]');if(!form)return;
      const values=Object.fromEntries(new FormData(form));memberDraft={...values,active:values.active==='on'};
    }
    function display() {
      const createExpanded=container.querySelector('.bp-create')?.open;
      container.hidden=!allowed();
      if(!allowed()){container.innerHTML='';return;}
      const selected=selectedOrganization();
      const selectedMembers=selected?memberList(selected.id):[];
      const selectedInvites=selected?orgInvites(selected.id):[];
      const activeCount=organizations.filter(item=>item.active).length;
      const selectedHistory=selectedInvites.slice(0,12);
      const orgRows=organizations.map(org=>{
        const list=memberList(org.id),activeMembers=list.filter(item=>item.active).length;
        return `<button type="button" class="bp-organization ${selectedId===org.id?'selected':''}" data-bp-select="${html(org.id)}" aria-pressed="${selectedId===org.id}"><span class="bp-org-icon" aria-hidden="true">${html(org.name?.slice(0,1).toUpperCase() || 'E')}</span><span class="bp-org-info"><strong>${html(org.name)}</strong><small>${html(org.slug)} · ${activeMembers}/${list.length} accesos activos</small></span><span class="bp-org-meta"><span class="bp-status ${org.active?'sent':'inactive'}">${org.active?'Activa':'Suspendida'}</span><small>${html(plans.find(item=>item.id===org.plan)?.label || org.plan)} · ${html(org.max_cases)} expedientes</small></span></button>`;
      }).join('');
      const createForm=`<details class="bp-create" ${organizations.length?'':'open'}><summary>+ Crear empresa independiente</summary><form data-bp-form="create"><p class="bp-help">La nueva empresa empieza sin expedientes y mantiene sus datos separados. Su administrador recibe una invitación para crear su contraseña.</p><div class="bp-grid">${field('Nombre de la empresa','name',createDraft.name,'text','required minlength="2" maxlength="120" autocomplete="organization"')}${field('Identificador del portal','slug',createDraft.slug,'text','required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxlength="80" placeholder="constructora-ejemplo"')}${field('Correo del administrador','admin_email',createDraft.admin_email,'email','required maxlength="254" autocomplete="email"')}${field('Nombre del administrador','admin_name',createDraft.admin_name,'text','required maxlength="160" autocomplete="name"')}<label class="bp-field"><span>Plan</span><select name="plan">${options(plans,createDraft.plan)}</select></label>${field('Capacidad de expedientes','max_cases',createDraft.max_cases,'number','required min="1" max="100000" step="1"')}</div><div class="bp-form-actions"><p data-bp-message="create" role="status"></p><button type="submit" class="primary compact">Crear empresa e invitar</button></div></form></details>`;
      const memberRows=selectedMembers.map(member=>{
        const invite=latestInvite(selected.id,member.email);
        return `<div class="bp-member-row"><div><strong>${html(member.display_name)}</strong><small>${html(member.email)}</small></div><div><span>${html(roles.find(item=>item.id===member.role)?.label || member.role)}</span><small>${member.active?'Acceso activo':'Acceso desactivado'}</small></div><div class="bp-member-actions"><span class="bp-status ${html(invite?.status||'inactive')}">${html(statusLabels[invite?.status] || 'Sin invitación')}</span><button type="button" class="ghost" data-bp-edit-member="${html(member.email)}">Editar acceso</button>${member.active?`<button type="button" class="ghost" data-bp-invite="${html(member.email)}" ${!selected.active?'disabled':''}>${invite?'Reenviar invitación':'Invitar'}</button>`:''}</div></div>`;
      }).join('');
      const memberForm=`<form data-bp-form="member" class="bp-member-form"><div class="bp-section-head"><h5>${memberEdit?'Editar acceso en':'Agregar persona a'} ${html(selected?.name||'esta empresa')}</h5>${memberEdit?'<button type="button" class="bp-link" data-bp-action="clear-member">Agregar otro</button>':''}</div><div class="bp-grid">${field('Correo de acceso','email',memberDraft.email,'email',`required maxlength="254" ${memberEdit?'readonly':''}`)}${field('Nombre','display_name',memberDraft.display_name,'text','required maxlength="160"')}<label class="bp-field"><span>Rol en esta empresa</span><select name="role">${options(roles,memberDraft.role)}</select></label><label class="bp-check"><input type="checkbox" name="active" ${memberDraft.active?'checked':''}><span>Acceso habilitado</span></label></div><p class="bp-help">Al habilitar este acceso, la persona podrá ver los expedientes de <strong>${html(selected?.name||'esta empresa')}</strong>. Para otra constructora, usá <strong>Crear empresa independiente</strong>.</p><div class="bp-form-actions"><p data-bp-message="member" role="status"></p><button type="submit" class="primary compact">${memberEdit?'Guardar acceso':'Agregar acceso'}</button></div></form>`;
      const selectedHtml=selected?`<div class="bp-detail-head"><div><p class="eyebrow">EMPRESA SELECCIONADA</p><h4>${html(selected.name)}</h4><p class="bp-help">${html(plans.find(item=>item.id===selected.plan)?.label || selected.plan)} · Hasta ${html(selected.max_cases)} expedientes</p></div><button type="button" class="ghost ${selected.active?'bp-danger':''}" data-bp-action="${selected.active?'confirm-suspend':'reactivate'}">${selected.active?'Suspender empresa':'Reactivar empresa'}</button></div>${suspensionId===selected.id?`<div class="bp-suspend-confirm" role="alert"><strong>Suspender ${html(selected.name)}</strong><p>Sus usuarios dejarán de acceder a esta empresa. Sus expedientes y archivos se conservan para una reactivación posterior.</p><div><button type="button" class="ghost" data-bp-action="cancel-suspend">Cancelar</button><button type="button" class="primary compact" data-bp-action="suspend">Confirmar suspensión</button></div></div>`:''}<div class="bp-activation"><div><strong>Enlace para activar el acceso</strong><p>La persona usa el correo autorizado para crear su contraseña.</p></div><button type="button" class="ghost" data-bp-action="copy-link">Copiar enlace</button><a href="${html(activationUrl(selected))}" target="_blank" rel="noopener">Abrir activación ↗</a></div><p data-bp-message="organization" class="bp-message" role="status"></p><div class="bp-section-head"><h5>Personas con acceso</h5><span class="bp-count">${selectedMembers.filter(item=>item.active).length} activas de ${selectedMembers.length}</span></div><div class="bp-member-list">${memberRows || '<p class="bp-empty">Esta empresa todavía no tiene personas asociadas.</p>'}</div>${memberForm}<div class="bp-section-head"><h5>Invitaciones recientes</h5><small>Últimas ${selectedHistory.length}</small></div><div class="bp-invite-list">${selectedHistory.map(invite=>`<div class="bp-invite-row"><div><strong>${html(invite.email)}</strong><small>${html(dateLabel(invite.created_at))}</small></div><span class="bp-status ${html(invite.status)}">${html(statusLabels[invite.status] || invite.status)}</span><small>${invite.status==='pending'?'Se enviará en la próxima ejecución del monitor.':invite.status==='review_required'?'Verificar entrega antes de reenviar.':invite.status==='failed'?'Podés solicitar una nueva invitación.':invite.sent_at?html(dateLabel(invite.sent_at)):''}</small></div>`).join('') || '<p class="bp-empty">Las invitaciones aparecerán aquí cuando se programe su envío.</p>'}</div>`:'<p class="bp-empty">Creá una empresa o seleccioná una de la lista.</p>';
      container.innerHTML=`<section class="bono-platform" aria-labelledby="bp-title"><div class="bp-heading"><div><p class="eyebrow">ADMINISTRACIÓN DE BONOALERTA</p><h3 id="bp-title">Empresas y accesos</h3><p>Organizá las empresas y las personas que pueden utilizar el sistema.</p></div></div><div class="bp-metrics"><article><strong>${organizations.length}</strong><span>empresas registradas</span></article><article><strong>${activeCount}</strong><span>empresas activas</span></article><article><strong>${members.filter(item=>item.active).length}</strong><span>accesos habilitados</span></article><article><strong>${invites.filter(item=>item.status==='pending').length}</strong><span>invitaciones en cola</span></article></div>${createForm}<div class="bp-layout"><aside class="bp-organizations" aria-label="Seleccionar empresa"><h4>Empresas</h4>${orgRows || '<p class="bp-empty">Todavía no hay empresas registradas.</p>'}</aside><section class="bp-detail" aria-label="Accesos de la empresa">${selectedHtml}</section></div></section>`;
      if(createExpanded!==undefined)container.querySelector('.bp-create').open=createExpanded;
      if(busy)setDisabled(true);
    }
    function setDisabled(value) {
      container.setAttribute('aria-busy',String(value));
      container.querySelectorAll('button,input,select').forEach(element=>{if(value){element.dataset.bpDisabled=String(element.disabled);element.disabled=true;}else{element.disabled=element.dataset.bpDisabled==='true';delete element.dataset.bpDisabled;}});
    }
    function errorMessage(error) {
      const message=String(error?.message||'');
      if(error?.code==='23505'||/already|duplicate|existe/i.test(message))return 'Ese identificador o correo ya está registrado. Revisá la empresa o el acceso existente.';
      if(error?.code==='42501'||/denied|denegado|permission/i.test(message))return 'La sesión no tiene permisos de administración global. Actualizá e ingresá nuevamente.';
      if(error?.code==='23514'||error?.code==='22023'||/invalid|válid|inactiv|suspendid/i.test(message))return 'Revisá los datos. La empresa debe estar activa y los campos deben tener valores válidos.';
      return 'No fue posible guardar el cambio. Los datos permanecen en el formulario para reintentar.';
    }
    async function runRpc(name,args,messageKey,successText,after) {
      if(!allowed()||busy)return;
      const message=container.querySelector(`[data-bp-message="${messageKey}"]`);
      busy=true;setDisabled(true);if(message){message.textContent='Guardando…';message.classList.remove('error');}
      try {
        const {data,error}=await client.rpc(name,args);if(error)throw error;
        if(after)after(data);
        if(message?.isConnected)message.textContent=successText;
        try {
          await onChanged({action:name,organizationId:args.p_organization_id||data?.organization_id||data?.id||null});
          toast(successText);
        } catch {
          if(message?.isConnected)message.textContent='El cambio fue guardado. Actualizá el panel para ver el resultado.';
          toast('Cambio guardado. Actualizá el panel para consultar el resultado.');
        }
      }catch(error){if(message?.isConnected){message.textContent=errorMessage(error);message.classList.add('error');}else toast(errorMessage(error));}
      finally{busy=false;setDisabled(false);}
    }
    container.addEventListener('input',event=>{
      const form=event.target.closest('[data-bp-form]');if(!form)return;
      if(form.dataset.bpForm==='create'){
        if(event.target.name==='slug')slugManual=true;
        if(event.target.name==='name'&&!slugManual)form.elements.slug.value=slugify(event.target.value);
        captureCreate();
      }else captureMember();
    });
    container.addEventListener('change',event=>{const form=event.target.closest('[data-bp-form]');if(form?.dataset.bpForm==='create')captureCreate();else if(form)captureMember();});
    container.addEventListener('submit',async event=>{
      const form=event.target.closest('[data-bp-form]');if(!form)return;event.preventDefault();if(!form.reportValidity()||!allowed())return;
      if(form.dataset.bpForm==='create'){
        captureCreate();const draft={...createDraft};
        await runRpc('platform_create_organization',{p_name:draft.name.trim(),p_slug:draft.slug.trim().toLowerCase(),p_admin_email:draft.admin_email.trim().toLowerCase(),p_admin_name:draft.admin_name.trim(),p_plan:draft.plan,p_max_cases:Number(draft.max_cases)},'create','Empresa creada e invitación programada.',data=>{selectedId=typeof data==='string'?data:data?.organization_id||data?.id||selectedId;createDraft={name:'',slug:'',admin_email:'',admin_name:'',plan:'basic',max_cases:20};slugManual=false;});
      }else if(selectedOrganization()){
        captureMember();const draft={...memberDraft};
        await runRpc('platform_save_member',{p_organization_id:selectedId,p_email:draft.email.trim().toLowerCase(),p_display_name:draft.display_name.trim(),p_role:draft.role,p_active:!!draft.active},'member','Acceso guardado.',()=>{memberEdit=null;memberDraft={email:'',display_name:'',role:'admin',active:true};});
      }
    });
    container.addEventListener('click',async event=>{
      const selectButton=event.target.closest('[data-bp-select]');
      if(selectButton&&!busy){captureCreate();selectedId=selectButton.dataset.bpSelect;memberEdit=null;memberDraft={email:'',display_name:'',role:'admin',active:true};suspensionId=null;display();return;}
      const editButton=event.target.closest('[data-bp-edit-member]');
      if(editButton&&!busy){captureCreate();const member=memberList(selectedId).find(item=>item.email===editButton.dataset.bpEditMember);if(!member)return;memberEdit=member.email;memberDraft={email:member.email,display_name:member.display_name,role:member.role,active:member.active};display();container.querySelector('[data-bp-form="member"] input[name="display_name"]').focus();return;}
      const inviteButton=event.target.closest('[data-bp-invite]');
      if(inviteButton&&!busy){await runRpc('platform_enqueue_member_invite',{p_organization_id:selectedId,p_email:inviteButton.dataset.bpInvite},'organization','Invitación programada para el próximo envío.');return;}
      const button=event.target.closest('[data-bp-action]');if(!button||busy||!allowed())return;
      const action=button.dataset.bpAction;
      if(action==='clear-member'){captureCreate();memberEdit=null;memberDraft={email:'',display_name:'',role:'admin',active:true};display();return;}
      if(action==='confirm-suspend'||action==='cancel-suspend'){captureCreate();captureMember();suspensionId=action==='confirm-suspend'?selectedId:null;display();return;}
      if(action==='suspend'||action==='reactivate'){await runRpc('platform_set_organization_active',{p_organization_id:selectedId,p_active:action==='reactivate'},'organization',action==='reactivate'?'Empresa reactivada.':'Empresa suspendida.',()=>{suspensionId=null;});return;}
      if(action==='copy-link'){
        const org=selectedOrganization();if(!org)return;
        try {await navigator.clipboard.writeText(activationUrl(org));toast('Enlace de activación copiado.');}
        catch{const message=container.querySelector('[data-bp-message="organization"]');message.textContent=`Enlace de activación: ${activationUrl(org)}`;}
      }
    });
    return {
      render(nextOrganizations=[],nextMembers=[],nextInvites=[]) {
        organizations=Array.isArray(nextOrganizations)?nextOrganizations:[];
        members=Array.isArray(nextMembers)?nextMembers:[];
        invites=Array.isArray(nextInvites)?nextInvites:[];
        if(!organizations.some(item=>item.id===selectedId))selectedId=context().currentOrganization?.id||organizations[0]?.id||null;
        if(!organizations.some(item=>item.id===selectedId))selectedId=organizations[0]?.id||null;
        display();
      },
      setLoading(value){busy=!!value;if(container.firstChild)setDisabled(busy);}
    };
  }
  scope.BonoPlatform={mount};
})(window);
