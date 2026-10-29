(function (global) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = () => global.crypto.randomUUID();
  const money = value => new Intl.NumberFormat('es-CR', {style:'currency',currency:'CRC',maximumFractionDigits:0}).format(Number(value) || 0);
  const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Costa_Rica',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const tabs = [['workflow','Modalidad y etapas'],['checklist','Requisitos'],['prequalification','Precalificación'],['formalization','Formalización'],['construction','Construcción'],['costs','Gastos']];
  const statuses = [{id:'pending',label:'Pendiente'},{id:'received',label:'Recibido'},{id:'approved',label:'Aprobado'},{id:'not_applicable',label:'No aplica'}];
  const pathGet = (obj,path) => path.split('.').reduce((value,key)=>value?.[key],obj);
  function pathSet(obj,path,value) {const keys=path.split('.');let target=obj;keys.slice(0,-1).forEach(key=>{target=target[key]??={};});target[keys.at(-1)]=value;}
  const options = (items,value) => items.map(item=>`<option value="${escape(item.id)}" ${item.id===value?'selected':''}>${escape(item.label)}</option>`).join('');

  function mount({container,client,getContext,onSaved=async()=>{},toast=()=>{}}) {
    if(typeof container==='string')container=document.querySelector(container);
    if(!container)throw new Error('Falta el contenedor de gestión');
    let watch=null,draft=null,uploaded=[],active='workflow',dirty=false,saving=false;
    const context=()=>getContext?.()||{};
    const role=()=>context().membership?.role||context().currentMembership?.role||context().role;
    const editable=()=>['owner','admin','agent'].includes(role());
    const organizationId=()=>context().organization?.id||context().currentOrganization?.id||context().organizationId||watch?.organization_id;
    const domain=()=>global.BonoCase;
    const modalities=()=>domain()?.modalities||[];
    const stages=()=>domain()?.stages||[];
    const requirements=modality=>(domain()?.requirementsFor(modality)||[]).map(item=>typeof item==='string'?{id:item,label:item}:item);
    const get=(key)=>pathGet(draft,key);
    function field(label,key,type='text',attrs='') {
      return `<label class="bm-field"><span>${escape(label)}</span><input data-bm-field="${escape(key)}" type="${type}" value="${escape(get(key))}" ${attrs}></label>`;
    }
    function select(label,key,items) {
      return `<label class="bm-field"><span>${escape(label)}</span><select data-bm-field="${escape(key)}">${options(items,get(key))}</select></label>`;
    }
    function textarea(label,key,attrs='') {
      return `<label class="bm-field bm-full"><span>${escape(label)}</span><textarea data-bm-field="${escape(key)}" rows="2" maxlength="2000" ${attrs}>${escape(get(key))}</textarea></label>`;
    }
    function checkbox(label,key) {return `<label class="bm-checkbox bm-full"><input type="checkbox" data-bm-field="${escape(key)}" ${get(key)?'checked':''}><span>${escape(label)}</span></label>`;}
    function docSelect(key,label='Archivo vinculado') {
      return select(label,key,[{id:'',label:'Sin archivo vinculado'},...uploaded.map(doc=>({id:doc.id,label:doc.name}))]);
    }
    function action(label,action,extra='') {return `<button type="button" class="ghost" data-bm-action="${action}" ${extra}>${label}</button>`;}
    function empty(text) {return `<p class="bm-empty">${text}</p>`;}
    function panel(id,html) {return `<section id="bm-panel-${id}" class="bm-panel" role="tabpanel" aria-labelledby="bm-tab-${id}" ${active!==id?'hidden':''}>${html}</section>`;}
    function refreshDirty() {const status=container.querySelector('[data-bm-dirty]');if(status)status.textContent=dirty?'Cambios sin guardar':'Cambios guardados';}
    function capture() {
      container.querySelectorAll('[data-bm-field]').forEach(el=>{
        let value=el.type==='checkbox'?el.checked:el.value;
        if(el.type==='number')value=value===''?null:Number(value);
        if(el.type==='date'&&value==='')value=null;
        if(el.dataset.bmField.endsWith('document_id')&&value==='')value=null;
        pathSet(draft,el.dataset.bmField,value);
      });
    }
    function render() {
      if(!watch||!draft)return;
      const readOnly=!editable();
      const checklist=draft.checklist||[];
      const completed=checklist.filter(item=>['approved','not_applicable'].includes(item.status)).length;
      const overdue=checklist.filter(item=>item.expires_on&&item.expires_on<today()&&item.status!=='not_applicable').length;
      const workflow=`<p class="bm-help">Etapas de tu equipo para organizar el expediente. El estado publicado por BANHVI se conserva en el historial de consulta.</p><div class="bm-grid">${select('Modalidad del bono','modality',modalities())}${select('Etapa interna','workflow_stage',stages())}${field('Entidad autorizada','financial_entity','text','maxlength="160" placeholder="Banco, mutual o cooperativa"')}</div><div class="bm-flow" aria-label="Etapas de gestión">${stages().map(stage=>`<span class="${draft.workflow_stage===stage.id?'current':''}">${escape(stage.label)}</span>`).join('')}</div><p class="bm-help">Al cambiar la modalidad se conserva el trabajo previo y se agregan sus requisitos sugeridos. La entidad puede solicitar documentos adicionales.</p><h5>Historial de gestión</h5><div class="bm-history">${(draft.stage_history||[]).length?(draft.stage_history||[]).slice().reverse().slice(0,20).map(item=>`<p><strong>${escape(stages().find(s=>s.id===(item.stage||item.to))?.label||item.stage||item.to||'Etapa actualizada')}</strong><small>${escape((item.entered_at||item.at)?new Date(item.entered_at||item.at).toLocaleString('es-CR',{timeZone:'America/Costa_Rica'}):item.date||'')}</small></p>`).join(''):empty('El historial se inicia al guardar la primera etapa.')}</div>`;
      const checklistHtml=`<div class="bm-section-head"><div><h5>Documentos del expediente</h5><p class="bm-help">${completed} de ${checklist.length} completados${overdue?` · ${overdue} con vencimiento pendiente de revisión`:''}</p></div>${action('+ Requisito','add-checklist')}</div><p class="bm-help">Vinculá archivos ya cargados en Documentos, debajo de esta sección. “Aprobado” se refiere a la revisión interna.</p><div class="bm-repeat">${checklist.map((item,index)=>`<article class="bm-item ${item.expires_on&&item.expires_on<today()&&item.status!=='not_applicable'?'bm-expired':''}"><div class="bm-grid">${field('Requisito',`checklist.${index}.label`,'text','required maxlength="200"')}${select('Estado',`checklist.${index}.status`,statuses)}${field('Vencimiento',`checklist.${index}.expires_on`,'date')}${field('Responsable',`checklist.${index}.responsible`,'text','maxlength="160"')}${docSelect(`checklist.${index}.document_id`)}${textarea('Observaciones',`checklist.${index}.notes`)}${checkbox('Compartir este requisito pendiente con el cliente',`checklist.${index}.client_visible`)}</div><div class="bm-item-actions">${item.document_id?action('Abrir archivo','open-document',`data-document="${escape(item.document_id)}"`):''}${action('Quitar requisito','remove-checklist',`data-index="${index}"`)}</div></article>`).join('')||empty('Elegí una modalidad para cargar sus requisitos o agregá uno propio.')}</div>`;
      const yesNo=[{id:'unknown',label:'Por confirmar'},{id:'yes',label:'Sí'},{id:'no',label:'No'}];
      const prequal=`<div class="bm-notice"><strong>Orientación preliminar</strong><p>Esta revisión ayuda a preparar el expediente. La entidad autorizada y BANHVI determinan la elegibilidad y aprobación.</p></div><div class="bm-grid">${select('¿Existe un núcleo familiar?','prequalification.family_nucleus',yesNo)}${select('¿Hay al menos una persona adulta?','prequalification.adult_member',yesNo)}${select('¿Nacionalidad o residencia legal acreditada?','prequalification.residency',yesNo)}${select('¿Ha recibido un bono anteriormente?','prequalification.previous_bono',yesNo)}${select('Situación de la propiedad','prequalification.property_situation',[{id:'unknown',label:'Por confirmar'},{id:'none',label:'Sin propiedad'},{id:'own_lot',label:'Lote propio'},{id:'family_lot',label:'Terreno familiar'},{id:'home',label:'Vivienda propia'},{id:'multiple',label:'Más de una propiedad'}])}${field('Ingreso familiar mensual (₡)','prequalification.monthly_income','number','min="0" step="0.01" max="1000000000"')}${field('Límite de ingresos verificado (₡)','prequalification.income_limit','number','min="0" step="0.01" max="1000000000"')}${field('Fuente oficial del límite','prequalification.source_url','url','maxlength="1000" placeholder="https://www.banhvi.fi.cr/…"')}${field('Fecha de verificación del límite','prequalification.verified_on','date')}${textarea('Observaciones de precalificación','prequalification.notes')}</div><p class="bm-help">El límite no se carga automáticamente: registrá el monto, enlace y fecha vigentes para la modalidad correspondiente.</p><div class="bm-prequal-result" aria-live="polite"></div>`;
      const formalization=`<div class="bm-notice"><strong>Meta interna configurable</strong><p>Confirmá el plazo aplicable con la entidad. Esta fecha organiza recordatorios y no establece un vencimiento legal universal.</p></div><div class="bm-grid">${field('Meta desde EMITIDO (días)','deadline_days','number','min="1" max="3650" step="1" required')}${field('Fecha de EMITIDO confirmada','emitted_on','date')}${field('Formalización completada','formalized_on','date')}${field('Notaría o profesional responsable','notary','text','maxlength="200"')}${field('Firma de escritura','deed_signed_on','date')}${field('Presentación al Registro','registry_presented_on','date')}${field('Tomo, asiento o referencia registral','registry_reference','text','maxlength="240"')}${field('Fecha de inscripción','registered_on','date')}</div><p class="bm-help">Si no ingresás una fecha de EMITIDO, se usa la más reciente del historial oficial. Marcar la formalización completada detiene los recordatorios de esta meta. Avisos preventivos: 30, 15, 10, 5, 1 y 0 días, según la configuración del monitor.</p><div class="bm-deadline-result" aria-live="polite"></div>`;
      const construction=draft.construction;
      const constructionHtml=`<p class="bm-help">Seguimiento técnico para modalidades con obra. Los desembolsos y aprobaciones se confirman con la entidad autorizada.</p><div class="bm-grid">${field('Presupuesto aprobado (₡)','construction.approved_budget','number','min="0" step="0.01" max="100000000000"')}${field('Avance de obra (%)','construction.progress','number','min="0" max="100" step="1"')}${field('Permiso municipal / referencia','construction.permit_reference','text','maxlength="240"')}${select('Estado de planos','construction.plans_status',[{id:'pending',label:'Pendientes'},{id:'in_review',label:'En revisión'},{id:'approved',label:'Aprobados'},{id:'not_applicable',label:'No aplica'}])}${field('Próxima inspección','construction.next_inspection','date')}</div><div class="bm-section-head"><h5>Hitos de obra</h5>${action('+ Hito','add-milestone')}</div>${construction.milestones.map((item,index)=>`<article class="bm-item"><div class="bm-grid">${field('Hito',`construction.milestones.${index}.label`,'text','required maxlength="200"')}${field('Programado para',`construction.milestones.${index}.due_on`,'date')}${field('Completado el',`construction.milestones.${index}.completed_on`,'date')}${textarea('Observaciones',`construction.milestones.${index}.notes`)}</div>${action('Quitar hito','remove-milestone',`data-index="${index}"`)}</article>`).join('')||empty('Registrá cimentación, paredes, cubierta, acabados o entrega.')}
      <div class="bm-section-head"><h5>Inspecciones</h5>${action('+ Inspección','add-inspection')}</div>${construction.inspections.map((item,index)=>`<article class="bm-item"><div class="bm-grid">${field('Fecha',`construction.inspections.${index}.date`,'date','required')}${field('Inspector/a',`construction.inspections.${index}.inspector`,'text','maxlength="200"')}${select('Resultado',`construction.inspections.${index}.result`,[{id:'scheduled',label:'Programada'},{id:'approved',label:'Conforme'},{id:'corrections',label:'Requiere correcciones'}])}${textarea('Observaciones',`construction.inspections.${index}.notes`)}</div>${action('Quitar inspección','remove-inspection',`data-index="${index}"`)}</article>`).join('')||empty('Sin inspecciones registradas.')}
      <div class="bm-section-head"><h5>Desembolsos recibidos</h5>${action('+ Desembolso','add-disbursement')}</div>${construction.disbursements.map((item,index)=>`<article class="bm-item"><div class="bm-grid">${field('Fecha',`construction.disbursements.${index}.date`,'date','required')}${field('Monto recibido (₡)',`construction.disbursements.${index}.amount`,'number','min="0" max="100000000000" step="0.01" required')}${textarea('Referencia y observaciones',`construction.disbursements.${index}.notes`)}</div>${action('Quitar desembolso','remove-disbursement',`data-index="${index}"`)}</article>`).join('')||empty('Sin desembolsos registrados.')}<p class="bm-total">Total recibido: <strong>${money(construction.disbursements.reduce((sum,item)=>sum+Number(item.amount||0),0))}</strong></p>
      <div class="bm-section-head"><h5>Fotografías de avance</h5>${action('+ Vincular fotografía','add-photo')}</div>${construction.photos.map((item,index)=>`<article class="bm-item"><div class="bm-grid">${docSelect(`construction.photos.${index}.document_id`,'Fotografía cargada')}${textarea('Descripción del avance',`construction.photos.${index}.notes`)}</div><div class="bm-item-actions">${item.document_id?action('Abrir fotografía','open-document',`data-document="${escape(item.document_id)}"`):''}${action('Quitar vínculo','remove-photo',`data-index="${index}"`)}</div></article>`).join('')||empty('Subí las fotografías en Documentos y vinculalas aquí.')}`;
      const totalCosts=draft.costs.reduce((sum,item)=>sum+Number(item.amount||0),0),paid=draft.costs.reduce((sum,item)=>sum+Number(item.paid||0),0);
      const costsHtml=`<div class="bm-notice"><strong>Estimación de gastos</strong><p>La entidad determina los montos finales y si corresponde cubrirlos con el bono, aporte familiar o crédito.</p></div><div class="bm-section-head"><h5>Presupuesto de trámites</h5>${action('+ Gasto','add-cost')}</div>${draft.costs.map((item,index)=>`<article class="bm-item"><div class="bm-grid">${field('Concepto',`costs.${index}.label`,'text','required maxlength="200"')}${select('Fuente prevista',`costs.${index}.payer`,[{id:'family',label:'Familia'},{id:'bono',label:'Bono (por confirmar)'},{id:'credit',label:'Crédito'},{id:'other',label:'Otra'}])}${field('Estimado (₡)',`costs.${index}.amount`,'number','min="0" max="100000000000" step="0.01" required')}${field('Pagado (₡)',`costs.${index}.paid`,'number','min="0" max="100000000000" step="0.01"')}</div>${action('Quitar gasto','remove-cost',`data-index="${index}"`)}</article>`).join('')||empty('Agregá avalúo, planos, permisos, inspecciones, gastos legales o seguros.')}<div class="bm-cost-summary"><span>Estimado<strong>${money(totalCosts)}</strong></span><span>Pagado<strong>${money(paid)}</strong></span><span>Saldo estimado<strong>${money(Math.max(0,totalCosts-paid))}</strong></span></div><h5>Financiamiento de referencia</h5><div class="bm-grid">${field('Aporte familiar previsto (₡)','construction.financing.family_contribution','number','min="0" max="100000000000" step="0.01"')}${field('Crédito complementario previsto (₡)','construction.financing.credit','number','min="0" max="100000000000" step="0.01"')}</div>`;
      container.innerHTML=`<div class="bono-management"><div class="bm-heading"><div><p class="eyebrow">GESTIÓN INTEGRAL</p><h4>Preparación y seguimiento</h4></div><span class="bm-saving-label" data-bm-dirty>${dirty?'Cambios sin guardar':'Cambios guardados'}</span></div><div class="bm-tabs" role="tablist" aria-label="Gestión del expediente">${tabs.map(([id,label])=>`<button type="button" id="bm-tab-${id}" role="tab" aria-controls="bm-panel-${id}" aria-selected="${active===id}" tabindex="${active===id?0:-1}" data-bm-tab="${id}">${label}</button>`).join('')}</div><form class="bm-form" novalidate><fieldset class="bm-fieldset" ${readOnly?'disabled':''}>${panel('workflow',workflow)}${panel('checklist',checklistHtml)}${panel('prequalification',prequal)}${panel('formalization',formalization)}${panel('construction',constructionHtml)}${panel('costs',costsHtml)}</fieldset><div class="bm-savebar"><p data-bm-message role="status">${readOnly?'Tu acceso permite consultar esta información.':'Guardá los cambios antes de cerrar el expediente.'}</p>${readOnly?'':'<button type="submit" class="primary compact">Guardar seguimiento</button>'}</div></form></div>`;
      container.querySelector('form').addEventListener('submit',save);
      container.querySelectorAll('[data-bm-tab]').forEach(button=>{
        button.addEventListener('click',()=>activate(button.dataset.bmTab));
        button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const index=tabs.findIndex(([id])=>id===active),next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;activate(tabs[next][0]);container.querySelector(`[data-bm-tab="${active}"]`).focus();});
      });
      updateResults();
    }
    function activate(id) {
      active=id;container.querySelectorAll('[data-bm-tab]').forEach(button=>{const selected=button.dataset.bmTab===id;button.setAttribute('aria-selected',selected);button.tabIndex=selected?0:-1;});
      container.querySelectorAll('.bm-panel').forEach(item=>item.hidden=item.id!==`bm-panel-${id}`);
    }
    function updateResults() {
      const pre=container.querySelector('.bm-prequal-result');
      if(pre){const result=domain()?.evaluatePrequalification(draft.prequalification);pre.innerHTML=result?`<strong>${escape(result.title)}</strong>${result.flags.length?`<ul>${result.flags.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`:''}${result.missing.length?`<ul>${result.missing.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`:''}<p>${escape(result.disclaimer)}</p>`:'<p>Completá la información y confirmá los requisitos con la entidad.</p>';}
      const deadline=container.querySelector('.bm-deadline-result');
      if(deadline){let info;try{info=domain()?.formalizationInfo(watch,draft);}catch{}deadline.innerHTML=info?.completed||draft.formalized_on?`<strong>Formalización completada</strong><p>${draft.formalized_on?`Registrada el ${escape(draft.formalized_on)}.`:'La etapa actual o el historial indica que la formalización ya fue completada.'}</p>`:info?`<strong>Seguimiento desde EMITIDO</strong><p>${escape(info.elapsed??info.elapsedDays??'—')} días transcurridos · ${escape(info.days??info.daysRemaining??'—')} días para la meta interna.</p>`:'<p>La cuenta comienza cuando exista una fecha de EMITIDO confirmada o detectada.</p>';}
    }
    container.addEventListener('input',event=>{if(!event.target.matches('[data-bm-field]'))return;capture();dirty=true;refreshDirty();updateResults();});
    container.addEventListener('change',event=>{
      if(!event.target.matches('[data-bm-field]'))return;capture();dirty=true;
      if(event.target.dataset.bmField==='modality'){const ids=new Set(draft.checklist.map(item=>item.id));requirements(draft.modality).forEach(item=>{if(!ids.has(item.id))draft.checklist.push({...item,status:'pending',expires_on:null,responsible:'',notes:'',document_id:null});});render();}
      else{refreshDirty();updateResults();}
    });
    container.addEventListener('click',async event=>{
      const button=event.target.closest('[data-bm-action]');if(!button)return;const actionId=button.dataset.bmAction;
      if(actionId==='open-document'){const doc=uploaded.find(item=>item.id===button.dataset.document);if(!doc)return;button.disabled=true;try{const {data,error}=await client.storage.from('monitor-documents').createSignedUrl(doc.storage_path,60);if(error||!data?.signedUrl)throw error||new Error();global.open(data.signedUrl,'_blank','noopener,noreferrer');}catch{toast('No fue posible abrir el archivo.');}finally{button.disabled=false;}return;}
      if(!editable()||saving)return;capture();
      const collections={checklist:draft.checklist,milestone:draft.construction.milestones,inspection:draft.construction.inspections,disbursement:draft.construction.disbursements,photo:draft.construction.photos,cost:draft.costs};
      const [,verb,kind]=actionId.match(/^(add|remove)-(.+)$/)||[];if(!collections[kind])return;
      if(verb==='remove'){collections[kind].splice(Number(button.dataset.index),1);}
      else {const defaults={checklist:{id:uid(),label:'',status:'pending',expires_on:null,responsible:'',notes:'',document_id:null},milestone:{id:uid(),label:'',due_on:null,completed_on:null,notes:''},inspection:{id:uid(),date:null,inspector:'',result:'scheduled',notes:''},disbursement:{id:uid(),date:null,amount:0,notes:''},photo:{document_id:null,notes:''},cost:{id:uid(),label:'',amount:0,paid:0,payer:'family'}};collections[kind].push(defaults[kind]);}
      dirty=true;render();
    });
    async function save(event) {
      event.preventDefault();if(saving||!editable())return;
      capture();const form=container.querySelector('form'),invalid=[...form.querySelectorAll('input,select,textarea')].find(el=>!el.checkValidity());
      if(invalid){activate(invalid.closest('[role="tabpanel"]').id.replace('bm-panel-',''));invalid.reportValidity();return;}
      const message=container.querySelector('[data-bm-message]');
      const p=draft.prequalification;
      if(p.income_limit!=null&&(!p.source_url||!p.verified_on)){active='prequalification';activate(active);message.textContent='Para usar un límite de ingresos, completá su fuente oficial y fecha de verificación.';message.classList.add('error');return;}
      if(draft.costs.some(item=>Number(item.paid||0)>Number(item.amount||0))){activate('costs');message.textContent='Un gasto pagado supera su monto estimado. Actualizá el estimado antes de guardar.';message.classList.add('error');return;}
      const allowed=['modality','workflow_stage','stage_entered_at','financial_entity','deadline_days','emitted_on','formalized_on','notary','deed_signed_on','registry_presented_on','registry_reference','registered_on','checklist','prequalification','construction','costs','stage_history'];
      const payload={watch_id:watch.id,organization_id:organizationId()};allowed.forEach(key=>{if(draft[key]!==undefined)payload[key]=draft[key];});
      saving=true;message.classList.remove('error');message.textContent='Guardando seguimiento…';const submit=form.querySelector('[type="submit"]');submit.disabled=true;
      try {const {data,error}=await client.from('monitor_case_profiles').upsert(payload,{onConflict:'watch_id'}).select().single();if(error)throw error;draft={...draft,...(data||payload)};dirty=false;refreshDirty();message.textContent='Seguimiento guardado.';await onSaved(data||payload);toast('Seguimiento actualizado');}
      catch(error){message.textContent=error?.code==='42P01'||error?.code==='PGRST205'?'Falta instalar la actualización de gestión en la base de datos.':'No se pudo guardar. Los cambios continúan aquí; intentá nuevamente.';message.classList.add('error');}
      finally{saving=false;if(submit.isConnected)submit.disabled=false;}
    }
    return {
      open(nextWatch,profile={},documents=[]) {
        watch=nextWatch;uploaded=documents.filter(item=>item.watch_id===watch.id);active='workflow';dirty=false;
        const defaults=domain()?.profileDefaults?.(watch)||{};
        draft={modality:'own_lot',workflow_stage:'prequalification',financial_entity:'',deadline_days:90,checklist:[],prequalification:{},construction:{},costs:[],stage_history:[],...clone(defaults),...clone(profile||{})};
        draft.prequalification={family_nucleus:'unknown',adult_member:'unknown',residency:'unknown',previous_bono:'unknown',property_situation:'unknown',monthly_income:null,income_limit:null,source_url:'',verified_on:null,notes:'',...draft.prequalification};
        draft.construction={progress:0,approved_budget:null,permit_reference:'',plans_status:'pending',next_inspection:null,inspections:[],milestones:[],disbursements:[],photos:[],...draft.construction};
        draft.construction.financing={family_contribution:null,credit:null,...draft.construction.financing};
        ['inspections','milestones','disbursements','photos'].forEach(key=>{if(!Array.isArray(draft.construction[key]))draft.construction[key]=[];});
        ['checklist','costs','stage_history'].forEach(key=>{if(!Array.isArray(draft[key]))draft[key]=[];});
        if(!draft.checklist.length)draft.checklist=requirements(draft.modality).map(item=>({...item,status:'pending',expires_on:null,responsible:'',notes:'',document_id:null}));
        render();
      },
      close(){container.innerHTML='';watch=null;draft=null;dirty=false;},
      getProfile(){if(draft)capture();return draft?clone(draft):null;},
      hasUnsavedChanges(){return dirty;}
    };
  }
  global.BonoManagement={mount};
})(window);
