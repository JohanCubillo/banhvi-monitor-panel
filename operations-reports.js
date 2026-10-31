/* Reports are derived from the signed-in organization's records. */
(function (global) {
  'use strict';
  let settings, host, organizationContext;
  const filterDefaults = () => ({from:'',to:'',entity:'',zone:'',bonoType:'',companyState:'',dateBasis:'created'});
  const filters = filterDefaults();
  let activeView='overview', breakdown='zone', charts=[], tableCursor=0, renderingTables=false;
  const tableModels=new Map(),tablePages=new Map();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const array = value => Array.isArray(value) ? value : [];
  const domain = () => global.BonoCase || {};
  const today = () => domain().todayISO?.() || new Intl.DateTimeFormat('en-CA', { timeZone:'America/Costa_Rica',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
  const day = value => { if(typeof value!=='string'||!value)return null;const part=value.slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(part))return null;if(domain().parseDate)return domain().parseDate(part);const date=new Date(part+'T12:00:00Z');return Number.isFinite(+date)&&date.toISOString().slice(0,10)===part?Math.floor(+date/86400000):null; };
  const displayDate = value => { const n=day(value); return n===null ? 'Sin fecha' : new Intl.DateTimeFormat('es-CR',{ dateStyle:'medium',timeZone:'UTC' }).format(new Date(n*86400000)); };
  const dateISO = value => value&&Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-CA',{timeZone:'America/Costa_Rica',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)) : '';
  const money = value => new Intl.NumberFormat('es-CR',{style:'currency',currency:'CRC',maximumFractionDigits:0}).format(Number(value)||0);
  const stageLabel = stage => array(domain().stages).find(s=>s.id===stage)?.label || stage || 'Sin etapa definida';
  const modalityLabel = modality => array(domain().modalities).find(s=>s.id===modality)?.label || modality || 'Sin modalidad';
  const elapsed = value => { const first=day(value), now=day(today()); return first===null||now===null ? null : Math.max(0,now-first); };
  const percent = (n,d) => d ? Math.round(n/d*100) : 0;
  const text = value => String(value??'').trim();
  const categoryLabel = category => ({ordinary_special:'Ordinarios y especiales',art59:'Artículo 59',follow_up:'Seguimiento'})[category]||'Sin clasificación';
  const intakeOf = profile => profile?.intake_data&&typeof profile.intake_data==='object'&&!Array.isArray(profile.intake_data)?profile.intake_data:{};
  const hasIntake = row => Object.keys(row.intake).length>0;
  const rawDate = (intake,key) => day(intake[key])!==null?displayDate(intake[key]):text(intake[key+'_text'])?`Sin fecha válida · ${text(intake[key+'_text'])}`:'Sin fecha';
  const monthLabel = key => new Intl.DateTimeFormat('es-CR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(key+'-01T12:00:00Z'));
  const sourceLabel = intake => array(intake.sources).map(source=>`${text(source.sheet)||'Hoja'} · fila ${text(source.row)||'sin número'}`).join('; ');
  function resetContext(data) {
    if(organizationContext!==data.organizationId){Object.assign(filters,filterDefaults());organizationContext=data.organizationId;activeView='overview';breakdown='zone';tablePages.clear();}
  }
  const scopedWatches = data => array(data.watches).filter(w=>!data.organizationId||w.organization_id===data.organizationId);
  function profileMap(profiles) {
    if(profiles instanceof Map) return profiles;
    if(Array.isArray(profiles)) return new Map(profiles.map(p=>[p.watch_id,p]));
    return new Map(Object.entries(profiles||{}));
  }
  function checklistStats(profile) {
    if(domain().checklistStats) return domain().checklistStats(array(profile.checklist));
    const items=array(profile.checklist).filter(i=>i.status!=='not_applicable');
    const complete=items.filter(i=>i.status==='approved' && (!i.expires_on||i.expires_on>=today())).length;
    const expired=items.filter(i=>i.expires_on&&i.expires_on<today()).length;
    return {total:items.length,complete,pending:items.length-complete,expired,percent:percent(complete,items.length)};
  }
  function record(watch, profile, tasks=[]) {
    const p=profile||{}, docs=checklistStats(p), deadline=domain().formalizationInfo?.(watch,p), construction=p.construction||{};
    const milestones=array(construction.milestones).filter(m=>m.due_on && m.due_on<today() && !m.completed_on);
    const inspection=construction.next_inspection_on || construction.next_inspection;
    const inspectionDue=inspection && inspection<=today();
    const daysInStage=elapsed(p.stage_entered_at), issues=[];
    if(watch.last_error)issues.push({kind:'danger',text:'Error de consulta BANHVI'});
    if(deadline&&!deadline.completed&&deadline.days<=10)issues.push({kind:deadline.days<=0?'danger':'warning',text:deadline.days<0?`Meta interna vencida hace ${Math.abs(deadline.days)} días`:`Meta interna: ${deadline.days} días restantes`});
    if(docs.expired)issues.push({kind:'danger',text:`${docs.expired} documento(s) vencido(s)`});
    if(docs.pending)issues.push({kind:'warning',text:`${docs.pending} documento(s) por completar`});
    if(!profile)issues.push({kind:'neutral',text:'Configurar modalidad y requisitos'});
    const lateTasks=array(tasks).filter(t=>t.watch_id===watch.id&&!t.completed_at&&t.due_at&&Date.parse(t.due_at)<Date.now());
    if(lateTasks.length)issues.push({kind:'warning',text:`${lateTasks.length} tarea(s) vencida(s)`});
    if(inspectionDue)issues.push({kind:'warning',text:'Inspección pendiente o prevista para hoy'});
    if(milestones.length)issues.push({kind:'danger',text:`${milestones.length} hito(s) de obra atrasado(s)`});
    if(p.workflow_stage==='construction'&&!construction.permit_number&&!construction.permit_reference&&!construction.permit_document_id)issues.push({kind:'warning',text:'Revisar registro del permiso de construcción'});
    const intake=intakeOf(p),submittedDay=day(intake.submitted_on),todayDay=day(today());
    return {watch,profile:p,intake,submissionAge:submittedDay===null?null:todayDay-submittedDay,docs,deadline,daysInStage,issues,entity:p.financial_entity||'Sin entidad',responsible:watch.assigned_to||'Sin responsable'};
  }
  function getRows() {
    const data=settings.getData()||{};resetContext(data);const profiles=profileMap(data.profiles);
    return scopedWatches(data).filter(w=>{
      const p=profiles.get(w.id),intake=intakeOf(p),entered=filters.dateBasis==='submitted'?(day(intake.submitted_on)!==null?intake.submitted_on:''):dateISO(w.created_at),entity=p?.financial_entity||'Sin entidad';
      return (!filters.from&&!filters.to||!!entered)&&(!filters.from||entered>=filters.from)&&(!filters.to||entered<=filters.to)&&(!filters.entity||entity===filters.entity)&&(!filters.zone||text(intake.zone)===filters.zone)&&(!filters.bonoType||text(intake.bono_type)===filters.bonoType)&&(!filters.companyState||text(intake.company_status)===filters.companyState);
    }).map(w=>record(w,profiles.get(w.id),data.tasks));
  }
  function group(rows,key) {
    const groups=new Map();
    rows.forEach(row=>{ const label=key(row); if(!groups.has(label))groups.set(label,[]);groups.get(label).push(row); });
    return [...groups].sort((a,b)=>b[1].length-a[1].length);
  }
  function stageDurations(rows) {
    const values=[];
    rows.forEach(row=>{
      const history=array(row.profile.stage_history).filter(h=>h.entered_at).sort((a,b)=>Date.parse(a.entered_at)-Date.parse(b.entered_at));
      for(let i=0;i<history.length-1;i++){
        const duration=(Date.parse(history[i+1].entered_at)-Date.parse(history[i].entered_at))/86400000;
        if(Number.isFinite(duration)&&duration>=0)values.push({stage:history[i].stage,days:duration});
      }
    });
    return values;
  }
  function table(headers,rows,empty='Todavía no hay registros para este detalle.') {
    if(renderingTables){const key=`report-table-${tableCursor++}`,model={headers,rows,empty,size:headers.length<=2?5:10};tableModels.set(key,model);return pagedTable(key,model);}
    return rows.length?`<div class="br-table-wrap"><table class="br-table"><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:`<p class="br-empty">${esc(empty)}</p>`;
  }
  function pagedTable(key,model){
    const pages=Math.max(1,Math.ceil(model.rows.length/model.size)),page=Math.min(Math.max(1,tablePages.get(key)||1),pages);tablePages.set(key,page);
    if(!model.rows.length)return `<div data-br-table="${key}"><p class="br-empty">${esc(model.empty)}</p></div>`;
    const start=(page-1)*model.size,end=Math.min(start+model.size,model.rows.length);
    return `<div data-br-table="${key}"><div class="br-table-wrap"><table class="br-table"><thead><tr>${model.headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${model.rows.slice(start,end).join('')}</tbody></table></div><div class="br-pager"><span role="status">Mostrando ${start+1}–${end} de ${model.rows.length}</span><nav aria-label="Páginas de ${esc(model.headers[0])}"><button type="button" class="ghost" data-br-page-table="${key}" data-br-page="${page-1}" ${page===1?'disabled':''}>Anterior</button><span>Página ${page} de ${pages}</span><button type="button" class="ghost" data-br-page-table="${key}" data-br-page="${page+1}" ${page===pages?'disabled':''}>Siguiente</button></nav></div></div>`;
  }
  function bindPagedTables(root=host){
    root.querySelectorAll('[data-br-page-table]').forEach(button=>button.onclick=()=>{if(button.disabled)return;const key=button.dataset.brPageTable,model=tableModels.get(key);if(!model)return;tablePages.set(key,Number(button.dataset.brPage));const old=host.querySelector(`[data-br-table="${key}"]`);old.outerHTML=pagedTable(key,model);const replacement=host.querySelector(`[data-br-table="${key}"]`);bindPagedTables(replacement);replacement.querySelector('[data-br-page-table]:not(:disabled)')?.focus({preventScroll:true});});
    root.querySelectorAll('[data-br-open]').forEach(button=>button.onclick=()=>settings.onOpen?.(button.dataset.brOpen));
  }
  function groupedTable(rows,key) {
    return table(['Grupo','Expedientes','Con pendientes','Días en etapa actual'],group(rows,key).map(([label,items])=>{
      const durations=items.map(r=>r.daysInStage).filter(n=>n!==null);
      const average=durations.length?`${Math.round(durations.reduce((a,b)=>a+b,0)/durations.length)} días`:'Sin registro';
      return `<tr><th scope="row">${esc(label)}</th><td>${items.length}</td><td>${items.filter(r=>r.issues.length).length}</td><td>${average}</td></tr>`;
    }));
  }
  function intakeBreakdown(rows,key,label) {
    return table([label,'Expedientes'],group(rows,row=>text(row.intake[key])||'Sin registrar').map(([value,items])=>`<tr><th scope="row">${esc(value)}</th><td>${items.length}</td></tr>`));
  }
  function latestConsultedState(watch) {
    const states=array(watch.last_states).filter(s=>domain().parseDate?.(s.date)!==null&&domain().parseDate?.(s.date)!==undefined);
    if(!states.length)return 'Sin consulta automática disponible';
    const latest=Math.max(...states.map(s=>domain().parseDate(s.date)));
    return states.filter(s=>domain().parseDate(s.date)===latest).map(s=>`${s.date}: ${s.description}`).join(' · ');
  }
  function intakeReports(rows) {
    const imported=rows.filter(hasIntake),withDates=imported.filter(row=>row.submissionAge!==null),missingDate=imported.length-withDates.length;
    const monthGroups=group(withDates,row=>row.intake.submitted_on.slice(0,7)).sort((a,b)=>a[0].localeCompare(b[0]));
    const ageGroups=[['0–30 días',r=>r.submissionAge>=0&&r.submissionAge<=30],['31–60 días',r=>r.submissionAge>=31&&r.submissionAge<=60],['61–90 días',r=>r.submissionAge>=61&&r.submissionAge<=90],['Más de 90 días',r=>r.submissionAge>90],['Fecha futura por revisar',r=>r.submissionAge<0],['Sin fecha válida',r=>r.submissionAge===null]];
    const specs=[['phone','Teléfono'],['house_model','Modelo'],['internal_color','Color interno'],['external_color','Color externo'],['gutter_color','Canoa'],['window_frame_color','Marcos'],['pvc_color','PVC']];
    const pendingSpecs=imported.map(row=>({row,missing:specs.filter(([key])=>!text(row.intake[key])).map(([,label])=>label)})).filter(item=>item.missing.length);
    const describedTasks=imported.filter(row=>text(row.intake.task_text)||text(row.intake.task_due_on)||text(row.intake.task_due_on_text)||text(row.intake.inspections));
    const sourceStats={submitted:imported.filter(row=>['ordinary_special','art59'].includes(row.intake.category)).length,followUp:imported.filter(row=>row.intake.category==='follow_up').length};
    return `<section class="br-section br-intake-report" data-br-intake><div class="br-section-heading"><div><p class="eyebrow">INFORMACIÓN DE LA PLANILLA</p><h4>Ingresos y seguimiento de la empresa</h4></div><span class="br-tag neutral">Referencia histórica</span></div><p class="br-hint">Registros guardados por la empresa desde sus listas. Las hojas complementarias se concilian por expediente; no se suman como clientes nuevos. Las fechas y los estados de la planilla no representan una consulta reciente al BANHVI.</p>
      <div class="br-intake-metrics"><article><strong>${imported.length}</strong><span>expedientes con datos de planilla</span></article><article><strong>${sourceStats.submitted}</strong><span>de listas de enviados</span></article><article><strong>${sourceStats.followUp}</strong><span>de seguimiento</span></article><article><strong>${missingDate}</strong><span>sin fecha de ingreso válida</span></article></div>
      ${!imported.length?'<p class="br-empty">No hay información de planilla importada en esta selección.</p>':''}
      <div class="br-grid"><section class="br-intake-block"><h5>Ingresados a entidad por mes</h5><p class="br-hint">Según la fecha original “Mes de ingreso”, conservando su día. Los registros sin fecha no se asignan a ningún mes.</p>${table(['Mes de ingreso','Ordinarios y especiales','Artículo 59','Seguimiento','Total'],monthGroups.map(([month,items])=>`<tr><th scope="row">${esc(monthLabel(month))}</th><td>${items.filter(r=>r.intake.category==='ordinary_special').length}</td><td>${items.filter(r=>r.intake.category==='art59').length}</td><td>${items.filter(r=>r.intake.category==='follow_up').length}</td><td>${items.length}</td></tr>`),'Sin fechas de ingreso válidas para agrupar.')}</section><section class="br-intake-block"><h5>Antigüedad desde ingreso a entidad</h5><p class="br-hint">Tiempo desde la fecha de la planilla. Estos intervalos no fijan plazos legales ni el contador de formalización.</p>${table(['Antigüedad registrada','Expedientes'],ageGroups.map(([label,predicate])=>`<tr><th scope="row">${esc(label)}</th><td>${imported.filter(predicate).length}</td></tr>`))}</section></div>
      <div class="br-grid br-intake-breakdowns"><section class="br-intake-block"><h5>Por entidad registrada</h5>${table(['Entidad','Expedientes'],group(imported,row=>row.entity).map(([label,items])=>`<tr><th scope="row">${esc(label)}</th><td>${items.length}</td></tr>`))}</section><section class="br-intake-block"><h5>Por zona</h5>${intakeBreakdown(imported,'zone','Zona')}</section><section class="br-intake-block"><h5>Por tipo de bono</h5>${intakeBreakdown(imported,'bono_type','Tipo registrado')}</section><section class="br-intake-block"><h5>Por estado de empresa</h5>${intakeBreakdown(imported,'company_status','Estado registrado')}</section><section class="br-intake-block"><h5>Por modelo de vivienda</h5>${intakeBreakdown(imported,'house_model','Modelo registrado')}</section></div>
      <section class="br-intake-block"><h5>Tareas e inspecciones descritas en planilla</h5><p class="br-hint">Una fecha pasada requiere revisar si la gestión continúa pendiente. Los textos sin fecha válida se conservan sin crear vencimientos.</p>${table(['Expediente','Tarea registrada','Fecha original','Seguimiento de fecha','Inspecciones registradas','Acción'],describedTasks.map(row=>{const intake=row.intake,n=day(intake.task_due_on),status=n===null?'Sin fecha válida':n<day(today())?'Fecha pasada · revisar':n===day(today())?'Fecha de hoy':'Fecha futura';return `<tr><th scope="row">${esc(row.watch.label||'Sin nombre')}</th><td>${esc(intake.task_text||'Sin tarea descrita')}</td><td>${esc(rawDate(intake,'task_due_on'))}</td><td><span class="br-tag ${n!==null&&n<day(today())?'warning':'neutral'}">${esc(status)}</span></td><td>${esc(intake.inspections||'Sin registrar')}</td><td><button type="button" class="br-text-button" data-br-open="${esc(row.watch.id)}">Revisar</button></td></tr>`;}),'Sin tareas o inspecciones registradas en la planilla.')}</section>
      <section class="br-intake-block"><h5>Contactos y especificaciones por completar</h5><p class="br-hint">Campos vacíos para revisión de la empresa; no se deduce la modalidad ni una condición familiar desde el modelo.</p>${table(['Expediente','Teléfono registrado','Modelo','Campos sin registrar','Acción'],pendingSpecs.map(({row,missing})=>`<tr><th scope="row">${esc(row.watch.label||'Sin nombre')}</th><td>${esc(row.intake.phone||'Sin registrar')}</td><td>${esc(row.intake.house_model||'Sin registrar')}</td><td>${esc(missing.join(', '))}</td><td><button type="button" class="br-text-button" data-br-open="${esc(row.watch.id)}">Completar</button></td></tr>`),'No hay campos vacíos entre las especificaciones registradas.')}</section>
      <section class="br-intake-block"><h5>Estados de planilla y consulta automática</h5><p class="br-hint">La columna de planilla reproduce su estado y fecha de referencia; no se utiliza como aprobación ni reemplaza el historial consultado por el robot.</p>${table(['Expediente','Estado BANHVI en planilla','Fecha de referencia','Estado de empresa','Estados de la última fecha consultada','Origen'],imported.map(row=>`<tr><th scope="row">${esc(row.watch.label||'Sin nombre')}</th><td>${esc(row.intake.reported_status||'Sin registrar')}</td><td>${esc(rawDate(row.intake,'reported_status_on'))}</td><td>${esc(row.intake.company_status||'Sin registrar')}</td><td>${esc(latestConsultedState(row.watch))}</td><td>${esc(sourceLabel(row.intake)||'Sin referencia de hoja')}</td></tr>`))}</section>
      <details class="br-intake-details"><summary>Ver detalle de ingresos y datos conservados</summary>${table(['Expediente','Ingreso a entidad','Antigüedad','Zona','Tipo de bono','Teléfono','Modelo','Observaciones'],imported.map(row=>`<tr><th scope="row">${esc(row.watch.label||'Sin nombre')}</th><td>${esc(rawDate(row.intake,'submitted_on'))}</td><td>${row.submissionAge===null?'Sin fecha':row.submissionAge<0?'Fecha futura':`${row.submissionAge} días`}</td><td>${esc(row.intake.zone||'Sin registrar')}</td><td>${esc(row.intake.bono_type||'Sin registrar')}</td><td>${esc(row.intake.phone||'Sin registrar')}</td><td>${esc(row.intake.house_model||'Sin registrar')}</td><td>${esc(row.intake.observations||'')}</td></tr>`))}</details></section>`;
  }
  const viewLabels={overview:'Resumen',intake:'Planilla',followup:'Seguimiento',detail:'Detalle'};
  const breakdownLabels={entity:'Entidad',zone:'Zona',bonoType:'Tipo de bono',companyState:'Estado de empresa',houseModel:'Modelo de vivienda'};
  const breakdownValue=(row,key)=>key==='entity'?row.entity:text(row.intake[({zone:'zone',bonoType:'bono_type',companyState:'company_status',houseModel:'house_model'})[key]])||'Sin registrar';
  function disclosure(node,title,open=false){
    const element=document.createElement('details');element.className='br-disclosure';element.open=open;
    const heading=node.querySelector('h4,h5'),model=tableModels.get(node.querySelector('[data-br-table]')?.dataset.brTable);
    const summary=document.createElement('summary');summary.textContent=title||heading?.textContent||'Ver detalle';
    if(model)summary.textContent+=` · ${model.rows.length} registros`;
    element.append(summary,node);return element;
  }
  function wrapDisclosure(node,title){const parent=node.parentNode,next=node.nextSibling,wrapper=disclosure(node,title);parent.insertBefore(wrapper,next);return wrapper;}
  function layoutReports(rows){
    const report=host.querySelector('.br-report'),children=[...report.children],nav=document.createElement('nav'),panels={};
    nav.className='br-view-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Vistas de reportes');
    nav.innerHTML=Object.entries(viewLabels).map(([key,label])=>`<button type="button" role="tab" id="br-tab-${key}" data-br-view="${key}" aria-controls="br-panel-${key}">${label}</button>`).join('');
    for(const key of Object.keys(viewLabels)){const panel=document.createElement('div');panel.id=`br-panel-${key}`;panel.className='br-view-panel';panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',`br-tab-${key}`);panels[key]=panel;}
    report.querySelector('.br-kpis').after(nav,...Object.values(panels));
    for(const node of children){
      if(node.matches('[data-br-intake]')){panels.intake.append(node);continue;}
      if(!node.matches('.br-grid,.br-section'))continue;
      const title=node.querySelector('h4')?.textContent||'';
      if(/Cartera por|Tiempo real|Seguimiento por entidad|Carga por responsable|Cambios y correos/.test(title))panels.overview.append(disclosure(node,title));
      else panels.followup.append(disclosure(node,title));
    }
    const overviewCharts=document.createElement('div');overviewCharts.className='br-chart-grid';overviewCharts.dataset.brCharts='overview';panels.overview.prepend(overviewCharts);
    const intake=panels.intake.querySelector('[data-br-intake]');
    if(intake){
      const area=document.createElement('div');area.className='br-chart-grid';area.dataset.brCharts='intake';intake.querySelector('.br-intake-metrics').after(area);
      const grids=[...intake.children].filter(child=>child.matches('.br-grid'));
      const monthly=grids.find(child=>!child.matches('.br-intake-breakdowns'));if(monthly)wrapDisclosure(monthly,'Ver detalle de ingresos y antigüedad');
      const groups=intake.querySelector('.br-intake-breakdowns');
      if(groups){
        const keys=['entity','zone','bonoType','companyState','houseModel'];[...groups.children].forEach((child,index)=>{child.dataset.brBreakdown=keys[index];child.hidden=keys[index]!==breakdown;});
        const tools=document.createElement('div');tools.className='br-breakdown-tools';tools.innerHTML=`<label>Distribución de la planilla<select data-br-breakdown-select>${Object.entries(breakdownLabels).map(([key,label])=>`<option value="${key}" ${key===breakdown?'selected':''}>${label}</option>`).join('')}</select></label><p>Elegí una agrupación para ver sus categorías y cantidades.</p>`;groups.before(tools);
        tools.querySelector('select').onchange=event=>{breakdown=event.target.value;groups.querySelectorAll('[data-br-breakdown]').forEach(child=>{child.hidden=child.dataset.brBreakdown!==breakdown;});drawCharts(rows);};
      }
      [...intake.children].filter(child=>child.matches('.br-intake-block')).forEach(child=>wrapDisclosure(child));
    }
    const followups=[...panels.followup.children];let first=true;
    followups.forEach(element=>{element.name='br-followup';const hasRows=!!element.querySelector('tbody tr');if(first&&hasRows){element.open=true;first=false;}element.addEventListener('toggle',()=>{if(element.open)followups.filter(other=>other!==element).forEach(other=>{other.open=false;});});});
    renderingTables=true;
    const clipped=value=>{const full=String(value??'');return full.length>85?full.slice(0,82)+'…':full;};
    panels.detail.innerHTML=`<section class="br-section"><h4>Detalle de expedientes</h4><p class="br-hint">La tabla usa los filtros de arriba. La exportación incluye toda la selección, independientemente de la página visible.</p>${table(['Expediente','Cédula','Entidad','Estado de empresa (planilla)','Consulta automática','Acción'],rows.map(row=>`<tr><th scope="row">${esc(row.watch.label||'Sin nombre')}</th><td>${esc(row.watch.cedula)}</td><td>${esc(row.entity)}</td><td title="${esc(row.intake.company_status||'')}">${esc(clipped(row.intake.company_status||'Sin registrar'))}</td><td title="${esc(latestConsultedState(row.watch))}">${esc(clipped(latestConsultedState(row.watch)))}</td><td><button type="button" class="br-text-button" data-br-open="${esc(row.watch.id)}">Ver expediente</button></td></tr>`))}</section>`;
    renderingTables=false;
    function activate(key,redraw=true){activeView=key;for(const [id,panel] of Object.entries(panels))panel.hidden=id!==key;nav.querySelectorAll('[data-br-view]').forEach(button=>{const selected=button.dataset.brView===key;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;});if(redraw)drawCharts(rows);}
    nav.querySelectorAll('[data-br-view]').forEach(button=>button.onclick=()=>activate(button.dataset.brView));
    nav.addEventListener('keydown',event=>{const buttons=[...nav.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);if(index<0)return;let next;if(event.key==='ArrowRight')next=(index+1)%buttons.length;else if(event.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;event.preventDefault();buttons[next].click();buttons[next].focus();});
    activate(Object.hasOwn(panels,activeView)?activeView:'overview',false);
  }
  function chartCard(area,title,labels,values,type='bar',horizontal=false,description=''){
    const figure=document.createElement('figure');figure.className='br-chart-card';
    const count=values.reduce((sum,value)=>sum+value,0);figure.innerHTML=`<figcaption><h4>${esc(title)}</h4><p>${esc(description||`${count} expedientes en la selección`)}</p></figcaption><div class="br-chart-canvas"><canvas role="img" aria-label="${esc(title)}. ${esc(labels.map((label,index)=>`${label}: ${values[index]}`).join('; '))}"></canvas></div><p class="br-chart-summary">${esc(labels.map((label,index)=>`${label}: ${values[index]}`).join(' · '))||'Sin datos para este gráfico.'}</p>`;area.append(figure);
    if(!global.Chart){const note=document.createElement('p');note.className='br-hint';note.textContent='El gráfico no está disponible. Podés consultar los valores y las tablas de detalle.';figure.querySelector('.br-chart-canvas').replaceWith(note);return;}
    if(!count){figure.querySelector('.br-chart-canvas').innerHTML='<p class="br-empty">Sin datos para este gráfico.</p>';return;}
    const colors=['#138c78','#0b4652','#76b9a9','#dbac43','#577f91','#c27b56','#91aa79','#7499b4','#b9c8c1'];
    try{
      const config={type,data:{labels,datasets:[{label:'Expedientes',data:values,backgroundColor:type==='doughnut'?colors:labels.map((_,i)=>colors[i%colors.length]),borderWidth:0,borderRadius:type==='bar'?5:0}]},options:{responsive:true,maintainAspectRatio:false,animation:false,indexAxis:horizontal?'y':'x',plugins:{legend:{display:type==='doughnut',position:'bottom',labels:{boxWidth:10,font:{size:11}}},tooltip:{callbacks:{title:items=>items[0]?.label||''}}},scales:type==='doughnut'?{}:horizontal?{x:{beginAtZero:true,ticks:{precision:0,font:{size:10}}},y:{ticks:{font:{size:10},callback:function(value){const label=String(this.getLabelForValue(value));return label.length>28?label.slice(0,25)+'…':label;}}}}:{x:{ticks:{font:{size:10},maxRotation:0,maxTicksLimit:7}},y:{beginAtZero:true,ticks:{precision:0,font:{size:10}}}}}};
      charts.push(new global.Chart(figure.querySelector('canvas'),config));
    }catch{figure.querySelector('.br-chart-canvas').innerHTML='<p class="br-empty">Consultá los valores en el detalle.</p>';}
  }
  function topSeries(rows,key){const grouped=group(rows,key),top=grouped.slice(0,8);if(grouped.length>8)top.push(['Otros (agrupados)',grouped.slice(8).flatMap(([,items])=>items)]);return{labels:top.map(([label])=>label),values:top.map(([,items])=>items.length),description:grouped.length>8?'8 categorías principales y el resto agrupado. El detalle conserva todas las categorías.':''};}
  function drawCharts(rows){
    charts.forEach(chart=>chart.destroy());charts=[];host.querySelectorAll('[data-br-charts]').forEach(area=>{area.innerHTML='';});
    if(activeView==='overview'){
      const area=host.querySelector('[data-br-charts="overview"]'),stages=topSeries(rows,row=>stageLabel(row.profile.workflow_stage)),entities=topSeries(rows,row=>row.entity);
      chartCard(area,'Cartera por etapa interna',stages.labels,stages.values,'doughnut',false,stages.description);chartCard(area,'Distribución por entidad',entities.labels,entities.values,'bar',true,entities.description);
    }else if(activeView==='intake'){
      const area=host.querySelector('[data-br-charts="intake"]'),imported=rows.filter(hasIntake),dated=imported.filter(row=>day(row.intake.submitted_on)!==null),months=group(dated,row=>row.intake.submitted_on.slice(0,7)).sort((a,b)=>a[0].localeCompare(b[0]));
      chartCard(area,'Ingresos informados por mes',months.map(([key])=>monthLabel(key)),months.map(([,items])=>items.length),'bar',false,`${dated.length} con fecha válida · ${imported.length-dated.length} sin fecha válida. Según la planilla.`);
      const series=topSeries(imported,row=>breakdownValue(row,breakdown));chartCard(area,`Por ${breakdownLabels[breakdown].toLocaleLowerCase()}`,series.labels,series.values,'bar',true,series.description);
    }
  }
  function filterOptions(values,current,emptyLabel) {
    return `<option value="">${esc(emptyLabel)}</option>`+[...new Set(values.map(text).filter(Boolean))].sort().map(value=>`<option value="${esc(value)}" ${current===value?'selected':''}>${esc(value)}</option>`).join('');
  }
  function captureFilters(form) {
    const values=new FormData(form);for(const key of Object.keys(filters))filters[key]=values.get(key)||filterDefaults()[key];
  }
  function render() {
    if(!host||!settings)return;
    const rows=getRows(), all=settings.getData()||{}, profiles=profileMap(all.profiles), allIntakes=scopedWatches(all).map(w=>intakeOf(profiles.get(w.id))),entities=[...new Set(scopedWatches(all).map(w=>profiles.get(w.id)?.financial_entity||'Sin entidad'))].sort();
    charts.forEach(chart=>chart.destroy());charts=[];tableModels.clear();tableCursor=0;renderingTables=true;
    const totalDocs=rows.reduce((a,r)=>a+r.docs.total,0), completeDocs=rows.reduce((a,r)=>a+r.docs.complete,0), duration=stageDurations(rows);
    const average=duration.length?`${(duration.reduce((a,r)=>a+r.days,0)/duration.length).toFixed(1)} días`:'Sin historial';
    const urgent=rows.filter(r=>r.issues.some(i=>i.kind==='danger')), near=rows.filter(r=>r.deadline&&!r.deadline.completed&&r.deadline.days<=30);
    const docRows=rows.flatMap(r=>array(r.profile.checklist).filter(d=>d.status!=='not_applicable'&&(d.status!=='approved'||(d.expires_on&&d.expires_on<today()))).map(doc=>({r,doc})));
    const overdue=rows.filter(r=>r.issues.length).sort((a,b)=>b.issues.filter(i=>i.kind==='danger').length-a.issues.filter(i=>i.kind==='danger').length);
    const selected=new Set(rows.map(r=>r.watch.id)), scopedEvents=array(all.events).filter(e=>selected.has(e.watch_id));
    const months=Array.from({length:6},(_,i)=>{const date=new Date(today()+'T12:00:00Z');date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-5+i);const key=date.toISOString().slice(0,7),changes=scopedEvents.filter(e=>dateISO(e.created_at).startsWith(key));return{label:new Intl.DateTimeFormat('es-CR',{month:'long',year:'numeric',timeZone:'UTC'}).format(date),total:changes.length,sent:changes.filter(e=>e.status==='sent').length,pending:changes.filter(e=>e.status==='pending').length,review:changes.filter(e=>e.status==='review_required').length};});
    const pendingTasks=array(all.tasks).filter(t=>selected.has(t.watch_id)&&!t.completed_at).sort((a,b)=>(a.due_at?Date.parse(a.due_at):Infinity)-(b.due_at?Date.parse(b.due_at):Infinity));
    const attachedFiles=array(all.documents).filter(d=>selected.has(d.watch_id)).length;
    const canExport=typeof settings.canExport==='function'?settings.canExport():settings.canExport!==false;
    host.innerHTML=`<div class="br-report"><header class="br-head"><div><p class="eyebrow">GESTIÓN DE CARTERA</p><h3>Reportes operativos</h3><p>Datos de los expedientes cargados · actualizado ${esc(displayDate(today()))}</p><p class="br-hint">Los estados BANHVI se obtienen automáticamente y son de solo consulta. Las etapas y tareas corresponden a la gestión interna de su empresa.</p></div>${canExport?'<div class="br-export-actions"><button type="button" class="ghost" data-br-excel>Exportar Excel</button><button type="button" class="ghost" data-br-export>Exportar reporte CSV</button></div>':''}</header>
      <form class="br-filters" data-br-filters><label>Base de fechas<select name="dateBasis"><option value="created" ${filters.dateBasis==='created'?'selected':''}>Alta en BonoAlerta</option><option value="submitted" ${filters.dateBasis==='submitted'?'selected':''}>Ingreso a entidad (planilla)</option></select></label><label>Desde · ${filters.dateBasis==='submitted'?'ingreso en planilla':'alta en BonoAlerta'}<input type="date" name="from" value="${esc(filters.from)}"></label><label>Hasta<input type="date" name="to" value="${esc(filters.to)}"></label><label>Entidad<select name="entity">${filterOptions(entities,filters.entity,'Todas las entidades')}</select></label><label>Zona<select name="zone">${filterOptions(allIntakes.map(i=>i.zone),filters.zone,'Todas las zonas')}</select></label><label>Tipo de bono<select name="bonoType">${filterOptions(allIntakes.map(i=>i.bono_type),filters.bonoType,'Todos los tipos')}</select></label><label>Estado de empresa<select name="companyState">${filterOptions(allIntakes.map(i=>i.company_status),filters.companyState,'Todos los estados de empresa')}</select></label><button class="ghost" type="submit">Aplicar filtros</button><button class="br-text-button" type="button" data-br-reset>Limpiar</button></form>
      ${filters.from&&filters.to&&filters.from>filters.to?'<p class="br-notice warning" role="status">La fecha inicial debe ser anterior a la fecha final.</p>':''}
      <div class="br-kpis"><article><span>En la selección</span><strong>${rows.length}</strong><small>${rows.filter(r=>r.watch.enabled).length} con monitoreo activo</small></article><article><span>Atención prioritaria</span><strong>${urgent.length}</strong><small>Errores, vencimientos o hitos atrasados</small></article><article><span>Documentación completa</span><strong>${totalDocs?`${percent(completeDocs,totalDocs)}%`:'—'}</strong><small>${completeDocs} de ${totalDocs} requisitos aplicables · ${attachedFiles} archivos adjuntos</small></article><article><span>Promedio por etapa finalizada</span><strong>${esc(average)}</strong><small>${duration.length} transiciones registradas</small></article></div>
      ${intakeReports(rows)}
      <div class="br-grid"><section class="br-section"><h4>Cartera por etapa interna</h4>${table(['Etapa','Expedientes','Distribución'],group(rows,r=>stageLabel(r.profile.workflow_stage)).map(([label,items])=>`<tr><th scope="row">${esc(label)}</th><td>${items.length}</td><td><div class="br-bar" aria-label="${percent(items.length,rows.length)}%"><span style="width:${percent(items.length,rows.length)}%"></span></div></td></tr>`))}</section><section class="br-section"><h4>Tiempo real entre etapas</h4><p class="br-hint">Sólo transiciones completadas con fecha registrada. La etapa actual no se incluye.</p>${table(['Etapa completada','Transiciones','Promedio'],group(duration,r=>stageLabel(r.stage)).map(([label,items])=>`<tr><th scope="row">${esc(label)}</th><td>${items.length}</td><td>${(items.reduce((a,r)=>a+r.days,0)/items.length).toFixed(1)} días</td></tr>`),'Los cambios de etapa que se registren a partir de ahora formarán este historial.')}</section></div>
      <div class="br-grid"><section class="br-section"><h4>Seguimiento por entidad</h4>${groupedTable(rows,r=>r.entity)}</section><section class="br-section"><h4>Carga por responsable</h4>${groupedTable(rows,r=>r.responsible)}</section></div>
      <section class="br-section"><h4>Cambios y correos por mes</h4><p class="br-hint">Cambios detectados por el monitor para los expedientes seleccionados. “Enviado” es la confirmación del proveedor, no de lectura.</p>${table(['Mes','Cambios','Enviados','Pendientes','Revisar'],months.map(m=>`<tr><th scope="row">${esc(m.label)}</th><td>${m.total}</td><td>${m.sent}</td><td>${m.pending}</td><td>${m.review}</td></tr>`))}</section>
      <section class="br-section"><h4>Tareas abiertas</h4>${table(['Expediente','Próxima acción','Fecha prevista','Responsable','Acción'],pendingTasks.map(t=>{const w=rows.find(r=>r.watch.id===t.watch_id)?.watch;return `<tr><th scope="row">${esc(w?.label||'Sin nombre')}</th><td>${esc(t.title)}</td><td>${t.due_at&&Date.parse(t.due_at)<Date.now()?'<span class="br-tag warning">Vencida</span>':''}${esc(displayDate(t.due_at))}</td><td>${esc(t.assigned_to||w?.assigned_to||'Sin responsable')}</td><td><button type="button" class="br-text-button" data-br-open="${esc(t.watch_id)}">Abrir</button></td></tr>`;}),'No hay tareas abiertas en la selección.')}</section>
      <section class="br-section"><h4>Metas internas de formalización</h4><p class="br-hint">Hasta 30 días restantes o vencidas. El plazo se configura por expediente y debe confirmarse con la entidad.</p>${table(['Expediente','Emisión','Meta','Restantes','Acción'],near.sort((a,b)=>a.deadline.days-b.deadline.days).map(r=>`<tr><th scope="row">${esc(r.watch.label||'Sin nombre')}</th><td>${esc(displayDate(r.deadline.emittedDate))}</td><td>${esc(displayDate(r.deadline.deadline||r.deadline.date))}</td><td><span class="br-tag ${r.deadline.days<=0?'danger':'warning'}">${r.deadline.days<0?`${Math.abs(r.deadline.days)} días vencida`:`${r.deadline.days} días`}</span></td><td><button type="button" class="br-text-button" data-br-open="${esc(r.watch.id)}">Abrir expediente</button></td></tr>`),'No hay metas internas próximas a vencer en la selección.')}</section>
      <section class="br-section"><h4>Documentos por completar o renovar</h4>${table(['Expediente','Requisito','Estado','Vencimiento','Responsable','Acción'],docRows.map(({r,doc})=>`<tr><th scope="row">${esc(r.watch.label||'Sin nombre')}</th><td>${esc(doc.label||doc.id)}</td><td><span class="br-tag ${doc.expires_on&&doc.expires_on<today()?'danger':'warning'}">${doc.expires_on&&doc.expires_on<today()?'Vencido':({received:'Recibido, por revisar',pending:'Pendiente',approved:'Aprobado'})[doc.status]||'Pendiente'}</span></td><td>${esc(displayDate(doc.expires_on))}</td><td>${esc(doc.responsible||r.responsible)}</td><td><button type="button" class="br-text-button" data-br-open="${esc(r.watch.id)}">Revisar</button></td></tr>`),'No hay requisitos pendientes en las listas configuradas. Los expedientes sin modalidad deben configurarse primero.')}</section>
      <section class="br-section"><h4>Próximas acciones y alertas</h4>${table(['Expediente','Etapa','Pendientes','Responsable','Acción'],overdue.map(r=>`<tr><th scope="row">${esc(r.watch.label||'Sin nombre')}</th><td>${esc(stageLabel(r.profile.workflow_stage))}</td><td>${r.issues.map(i=>`<span class="br-tag ${i.kind}">${esc(i.text)}</span>`).join(' ')}</td><td>${esc(r.responsible)}</td><td><button type="button" class="br-text-button" data-br-open="${esc(r.watch.id)}">Gestionar</button></td></tr>`),'No hay pendientes operativos en la selección.')}</section>
      <section class="br-section"><h4>Construcción e inspecciones</h4>${table(['Expediente','Avance registrado','Presupuesto aprobado','Desembolsado','Inspecciones','Acción'],rows.filter(r=>r.profile.workflow_stage==='construction'||array(r.profile.construction?.inspections).length).map(r=>{const c=r.profile.construction||{};return `<tr><th scope="row">${esc(r.watch.label||'Sin nombre')}</th><td>${Math.min(100,Math.max(0,Number(c.progress)||0))}%</td><td>${esc(money(c.approved_budget))}</td><td>${esc(money(array(c.disbursements).reduce((a,v)=>a+(Number(v.amount)||0),0)))}</td><td>${array(c.inspections).length}</td><td><button type="button" class="br-text-button" data-br-open="${esc(r.watch.id)}">Ver obra</button></td></tr>`;}),'Todavía no hay obras o inspecciones registradas.')}</section>
      <p class="br-hint">Etapas, fechas y avances internos son registros de su empresa. Los estados BANHVI se conservan por separado.</p></div>`;
    renderingTables=false;layoutReports(rows);bindPagedTables();drawCharts(rows);
    host.querySelector('[data-br-filters]').onsubmit=event=>{event.preventDefault();tablePages.clear();captureFilters(event.currentTarget);render();};
    host.querySelector('[name="dateBasis"]').onchange=event=>{tablePages.clear();captureFilters(event.target.form);render();};
    host.querySelector('[data-br-reset]').onclick=()=>{Object.assign(filters,filterDefaults());tablePages.clear();render();};
    host.querySelectorAll('[data-br-open]').forEach(button=>button.onclick=()=>settings.onOpen?.(button.dataset.brOpen));
    const exportButton=host.querySelector('[data-br-export]');if(exportButton)exportButton.onclick=exportCsv;
    const excelButton=host.querySelector('[data-br-excel]');if(excelButton)excelButton.onclick=exportExcel;
  }
  function exportCsv() {
    if(typeof settings.canExport==='function'?!settings.canExport():settings.canExport===false)return;
    const rows=getRows();
    if(!rows.length){settings.toast?.('No hay expedientes en esta selección.');return;}
    const headers=[...reportHeaders,...intakeHeaders.slice(2)];
    const cell=value=>`"${String(value??'').replace(/^[\s]*[=+\-@]/,m=>"'"+m).replace(/"/g,'""')}"`;
    const csv=[headers,...rows.map(r=>[...reportValues(r),...intakeValues(r).slice(2)])].map(row=>row.map(cell).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8;'})),link=document.createElement('a');link.href=url;link.download=`bonoalerta-reporte-${today()}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);settings.toast?.('Reporte descargado.');
  }
  const reportHeaders=['Referencia','Caso BANHVI','Modalidad','Etapa interna','Entidad','Responsable','Días en etapa','Documentos aplicables','Documentos completos','Documentos vencidos','Fecha meta interna','Días restantes','Pendientes'];
  const intakeHeaders=['Referencia','Cédula','Categoría de planilla','Entidad','Tipo de bono registrado','Zona','Ingreso a entidad (planilla)','Texto original de ingreso','Días desde ingreso a entidad','Alta en BonoAlerta','Estado BANHVI en planilla','Fecha estado de planilla','Texto original fecha estado','Estado de empresa','Consulta automática (última fecha)','Teléfono','Modelo de vivienda','Color interno','Color externo','Color canoa','Color marco de ventana','Color tablilla PVC','Observación/cotización','Inicio construcción (planilla)','Texto original inicio','Finalización construcción (planilla)','Texto original finalización','Inspecciones (planilla)','Tarea (planilla)','Fecha tarea (planilla)','Texto original fecha tarea','Observaciones','Origen hoja y fila'];
  const reportValues = r => [r.watch.label,r.watch.case_number||'',modalityLabel(r.profile.modality),stageLabel(r.profile.workflow_stage),r.entity,r.responsible,r.daysInStage,r.docs.total,r.docs.complete,r.docs.expired,r.deadline&&!r.deadline.completed?r.deadline.deadline||r.deadline.date:'',r.deadline&&!r.deadline.completed?r.deadline.days:'',r.issues.map(i=>i.text).join(' · ')];
  function intakeValues(row) {
    const i=row.intake;
    return [row.watch.label,row.watch.cedula,categoryLabel(i.category),row.entity,i.bono_type,i.zone,day(i.submitted_on)!==null?i.submitted_on:'',i.submitted_on_text,row.submissionAge,dateISO(row.watch.created_at),i.reported_status,day(i.reported_status_on)!==null?i.reported_status_on:'',i.reported_status_on_text,i.company_status,latestConsultedState(row.watch),i.phone,i.house_model,i.internal_color,i.external_color,i.gutter_color,i.window_frame_color,i.pvc_color,i.quote_notes,day(i.construction_started_on)!==null?i.construction_started_on:'',i.construction_started_on_text,day(i.construction_completed_on)!==null?i.construction_completed_on:'',i.construction_completed_on_text,i.inspections,i.task_text,day(i.task_due_on)!==null?i.task_due_on:'',i.task_due_on_text,i.observations,sourceLabel(i)];
  }
  function exportExcel() {
    if(typeof settings.canExport==='function'?!settings.canExport():settings.canExport===false)return;
    const rows=getRows();if(!rows.length){settings.toast?.('No hay expedientes en esta selección.');return;}
    const xml=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
    // Every value is explicitly text. Imported cédulas keep leading zeroes and
    // spreadsheet-looking text can never become a formula in this workbook.
    const worksheet=(name,headers,values)=>`<Worksheet ss:Name="${xml(name)}"><Table>${headers.map(()=>'<Column ss:Width="150"/>').join('')}<Row ss:StyleID="Header">${headers.map(value=>`<Cell><Data ss:Type="String">${xml(value)}</Data></Cell>`).join('')}</Row>${values.map(row=>`<Row>${row.map(value=>`<Cell><Data ss:Type="String">${xml(value)}</Data></Cell>`).join('')}</Row>`).join('')}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>`;
    const workbook=`<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0B3B47" ss:Pattern="Solid"/></Style></Styles>${worksheet('Reporte',reportHeaders,rows.map(reportValues))}${worksheet('Detalle planilla',intakeHeaders,rows.map(intakeValues))}</Workbook>`;
    const url=URL.createObjectURL(new Blob([workbook],{type:'application/vnd.ms-excel;charset=utf-8;'})),link=document.createElement('a');link.href=url;link.download=`bonoalerta-reporte-${today()}.xls`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);settings.toast?.('Excel descargado con la selección actual.');
  }
  function educationHtml() {
    return `<section class="br-education"><h3>Entienda el proceso de su bono de vivienda</h3><details><summary>¿Qué significa cada etapa?</summary><p>Su asesor reúne los documentos, la entidad autorizada revisa la solicitud y la presenta al BANHVI. Después pueden existir gestiones de aprobación, emisión, formalización y, según la modalidad, construcción e inspecciones.</p><p>Un estado de seguimiento describe una gestión. La resolución y los requisitos definitivos corresponden a la entidad autorizada y al BANHVI.</p></details><details><summary>¿Qué documentos debo preparar?</summary><p>Los requisitos dependen de su familia, la propiedad y la modalidad. Su asesor puede solicitar identificaciones, constancias de ingresos, certificaciones y documentos de la propiedad. Para construir o reparar también pueden requerirse presupuesto, planos, permisos e informes técnicos.</p><p>Entregue los documentos por el canal seguro indicado por su asesor y confirme cuáles deben renovarse.</p></details><details><summary>¿El bono tiene costo?</summary><p>El bono es una ayuda estatal. El proceso puede generar gastos autorizados, por ejemplo avalúos, planos, inspecciones y trámites legales. Solicite un desglose y comprobantes a la entidad antes de efectuar pagos.</p></details><details><summary>¿Qué hago después de la emisión?</summary><p>Consulte a su asesor y a la entidad qué firmas, documentos y gestiones de formalización debe completar. Las fechas aplicables se deben confirmar para su expediente.</p></details><p class="br-hint">Información general. Consulte las <a href="https://www.mivah.go.cr/Preguntas_Frecuentes.shtml" target="_blank" rel="noopener noreferrer">preguntas frecuentes del MIVAH</a> y los <a href="https://www.banhvi.fi.cr/publicaciones/capacitacion/DeberesyDerechos.aspx" target="_blank" rel="noopener noreferrer">deberes y derechos publicados por BANHVI</a>. BonoAlerta es un servicio independiente.</p></section>`;
  }
  function clientSummaryHtml(data) {
    // Only use deliberately shared fields from the portal RPC, never an admin profile.
    const summary=data?.client_summary||{};
    if(!summary.next_step&&!summary.advisor&&!array(summary.pending_documents).length)return '';
    return `<section class="client-section br-shared"><h3>Su próximo paso</h3>${summary.next_step?`<p>${esc(summary.next_step)}</p>`:''}${summary.advisor?`<p>Asesor: ${esc(summary.advisor)}</p>`:''}${array(summary.pending_documents).length?`<h4>Documentos solicitados</h4><ul>${summary.pending_documents.map(doc=>`<li>${esc(typeof doc==='string'?doc:doc.label)}</li>`).join('')}</ul>`:''}</section>`;
  }
  function printCase(watch,profile={},notes=[],documents=[],tasks=[]) {
    const data=record(watch,profile), css='body{font:14px/1.5 Arial,sans-serif;color:#173740;margin:35px}h1{font-size:26px}h2{font-size:18px;margin-top:26px}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left;border-bottom:1px solid #ddd}p{white-space:pre-wrap}.muted{color:#666}@page{size:A4;margin:16mm}@media print{body{margin:0}tr{break-inside:avoid}}';
    const body=`<h1>BonoAlerta · Expediente administrativo</h1><p class="muted">Generado: ${esc(displayDate(today()))} · Uso interno</p><h2>${esc(watch.label||'Sin nombre')}</h2><table><tr><th>Cédula</th><td>${esc(watch.cedula)}</td><th>Caso</th><td>${esc(watch.case_number||'Pendiente')}</td></tr><tr><th>Modalidad</th><td>${esc(modalityLabel(profile.modality))}</td><th>Etapa interna</th><td>${esc(stageLabel(profile.workflow_stage))}</td></tr><tr><th>Entidad</th><td>${esc(data.entity)}</td><th>Responsable</th><td>${esc(data.responsible)}</td></tr></table><h2>Historial de estados BANHVI</h2>${table(['Fecha','Descripción'],array(watch.last_states).map(s=>`<tr><td>${esc(s.date)}</td><td>${esc(s.description)}</td></tr>`))}<h2>Requisitos</h2>${table(['Documento','Estado','Vencimiento'],array(profile.checklist).map(d=>`<tr><td>${esc(d.label)}</td><td>${esc(d.status)}</td><td>${esc(displayDate(d.expires_on))}</td></tr>`))}<h2>Formalización</h2><p>${data.deadline?`Meta interna: ${esc(displayDate(data.deadline.deadline||data.deadline.date))} · ${data.deadline.days} días restantes. `:''}Firma: ${esc(displayDate(profile.deed_signed_on))} · Presentación al Registro: ${esc(displayDate(profile.registry_presented_on))} · Referencia: ${esc(profile.registry_reference||'Sin registrar')}</p><h2>Obra</h2><p>Avance: ${Number(profile.construction?.progress)||0}% · Presupuesto: ${esc(money(profile.construction?.approved_budget))}</p><h2>Gastos estimados</h2>${table(['Concepto','Monto estimado'],array(profile.costs).map(c=>`<tr><td>${esc(c.label||c.name)}</td><td>${esc(money(c.amount))}</td></tr>`))}<h2>Tareas</h2>${table(['Tarea','Fecha','Estado'],array(tasks).filter(t=>t.watch_id===watch.id).map(t=>`<tr><td>${esc(t.title)}</td><td>${esc(displayDate(t.due_at))}</td><td>${t.completed_at?'Completada':'Pendiente'}</td></tr>`))}<h2>Notas</h2>${array(notes).filter(n=>n.watch_id===watch.id).map(n=>`<p><strong>${esc(displayDate(n.created_at))}</strong><br>${esc(n.body)}</p>`).join('')||'<p>Sin notas</p>'}<h2>Índice de archivos adjuntos</h2>${array(documents).filter(d=>d.watch_id===watch.id).map(d=>`<p>${esc(d.name)}</p>`).join('')||'<p>Sin archivos</p>'}<p class="muted">Este documento resume registros internos y estados de seguimiento. Consulte la resolución y los plazos aplicables con la entidad autorizada.</p>`;
    const frame=document.createElement('iframe');frame.title='Expediente para impresión';frame.style.cssText='position:fixed;width:1px;height:1px;left:-9999px;border:0';
    frame.onload=()=>{setTimeout(()=>{try{frame.contentWindow.focus();frame.contentWindow.print();}catch{settings?.toast?.('No se pudo abrir la impresión.');}},200);};
    frame.srcdoc=`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Expediente BonoAlerta</title><style>${css}</style></head><body>${body}</body></html>`;document.body.append(frame);setTimeout(()=>frame.remove(),120000);
  }
  global.BonoReports={mount(options){settings=options;host=typeof options.container==='string'?document.querySelector(options.container):options.container;render();return this;},render,printCase,educationHtml,clientSummaryHtml};
})(globalThis);
