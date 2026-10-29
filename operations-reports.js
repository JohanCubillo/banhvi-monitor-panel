/* Reports are derived from the signed-in organization's records. */
(function (global) {
  'use strict';
  let settings, host;
  const filters = { from: '', to: '', entity: '' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const array = value => Array.isArray(value) ? value : [];
  const domain = () => global.BonoCase || {};
  const today = () => domain().todayISO?.() || new Intl.DateTimeFormat('en-CA', { timeZone:'America/Costa_Rica',year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
  const day = value => { if (!value) return null; const date = new Date(String(value).slice(0,10) + 'T12:00:00Z'); return Number.isFinite(+date) ? Math.floor(+date/86400000) : null; };
  const displayDate = value => { const n=day(value); return n===null ? 'Sin fecha' : new Intl.DateTimeFormat('es-CR',{ dateStyle:'medium',timeZone:'UTC' }).format(new Date(n*86400000)); };
  const dateISO = value => value ? new Intl.DateTimeFormat('en-CA',{timeZone:'America/Costa_Rica',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)) : '';
  const money = value => new Intl.NumberFormat('es-CR',{style:'currency',currency:'CRC',maximumFractionDigits:0}).format(Number(value)||0);
  const stageLabel = stage => array(domain().stages).find(s=>s.id===stage)?.label || stage || 'Sin etapa definida';
  const modalityLabel = modality => array(domain().modalities).find(s=>s.id===modality)?.label || modality || 'Sin modalidad';
  const elapsed = value => { const first=day(value), now=day(today()); return first===null||now===null ? null : Math.max(0,now-first); };
  const percent = (n,d) => d ? Math.round(n/d*100) : 0;
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
    return {watch,profile:p,docs,deadline,daysInStage,issues,entity:p.financial_entity||'Sin entidad',responsible:watch.assigned_to||'Sin responsable'};
  }
  function getRows() {
    const data=settings.getData()||{}, profiles=profileMap(data.profiles);
    return array(data.watches).filter(w=>{
      const entered=dateISO(w.created_at), entity=profiles.get(w.id)?.financial_entity||'Sin entidad';
      return (!filters.from||entered>=filters.from)&&(!filters.to||entered<=filters.to)&&(!filters.entity||entity===filters.entity);
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
    return rows.length?`<div class="br-table-wrap"><table class="br-table"><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:`<p class="br-empty">${esc(empty)}</p>`;
  }
  function groupedTable(rows,key) {
    return table(['Grupo','Expedientes','Con pendientes','Días en etapa actual'],group(rows,key).map(([label,items])=>{
      const durations=items.map(r=>r.daysInStage).filter(n=>n!==null);
      const average=durations.length?`${Math.round(durations.reduce((a,b)=>a+b,0)/durations.length)} días`:'Sin registro';
      return `<tr><th scope="row">${esc(label)}</th><td>${items.length}</td><td>${items.filter(r=>r.issues.length).length}</td><td>${average}</td></tr>`;
    }));
  }
  function render() {
    if(!host||!settings)return;
    const rows=getRows(), all=settings.getData()||{}, profiles=profileMap(all.profiles), entities=[...new Set(array(all.watches).map(w=>profiles.get(w.id)?.financial_entity||'Sin entidad'))].sort();
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
    host.innerHTML=`<div class="br-report"><header class="br-head"><div><p class="eyebrow">GESTIÓN DE CARTERA</p><h3>Reportes operativos</h3><p>Datos de los expedientes cargados · actualizado ${esc(displayDate(today()))}</p></div>${canExport?'<button type="button" class="ghost" data-br-export>Exportar reporte CSV</button>':''}</header>
      <form class="br-filters" data-br-filters><label>Ingresados desde<input type="date" name="from" value="${esc(filters.from)}"></label><label>Hasta<input type="date" name="to" value="${esc(filters.to)}"></label><label>Entidad<select name="entity"><option value="">Todas las entidades</option>${entities.map(e=>`<option ${filters.entity===e?'selected':''} value="${esc(e)}">${esc(e)}</option>`).join('')}</select></label><button class="ghost" type="submit">Aplicar filtros</button><button class="br-text-button" type="button" data-br-reset>Limpiar</button></form>
      ${filters.from&&filters.to&&filters.from>filters.to?'<p class="br-notice warning" role="status">La fecha inicial debe ser anterior a la fecha final.</p>':''}
      <div class="br-kpis"><article><span>En la selección</span><strong>${rows.length}</strong><small>${rows.filter(r=>r.watch.enabled).length} con monitoreo activo</small></article><article><span>Atención prioritaria</span><strong>${urgent.length}</strong><small>Errores, vencimientos o hitos atrasados</small></article><article><span>Documentación completa</span><strong>${totalDocs?`${percent(completeDocs,totalDocs)}%`:'—'}</strong><small>${completeDocs} de ${totalDocs} requisitos aplicables · ${attachedFiles} archivos adjuntos</small></article><article><span>Promedio por etapa finalizada</span><strong>${esc(average)}</strong><small>${duration.length} transiciones registradas</small></article></div>
      <div class="br-grid"><section class="br-section"><h4>Cartera por etapa interna</h4>${table(['Etapa','Expedientes','Distribución'],group(rows,r=>stageLabel(r.profile.workflow_stage)).map(([label,items])=>`<tr><th scope="row">${esc(label)}</th><td>${items.length}</td><td><div class="br-bar" aria-label="${percent(items.length,rows.length)}%"><span style="width:${percent(items.length,rows.length)}%"></span></div></td></tr>`))}</section><section class="br-section"><h4>Tiempo real entre etapas</h4><p class="br-hint">Sólo transiciones completadas con fecha registrada. La etapa actual no se incluye.</p>${table(['Etapa completada','Transiciones','Promedio'],group(duration,r=>stageLabel(r.stage)).map(([label,items])=>`<tr><th scope="row">${esc(label)}</th><td>${items.length}</td><td>${(items.reduce((a,r)=>a+r.days,0)/items.length).toFixed(1)} días</td></tr>`),'Los cambios de etapa que se registren a partir de ahora formarán este historial.')}</section></div>
      <div class="br-grid"><section class="br-section"><h4>Seguimiento por entidad</h4>${groupedTable(rows,r=>r.entity)}</section><section class="br-section"><h4>Carga por responsable</h4>${groupedTable(rows,r=>r.responsible)}</section></div>
      <section class="br-section"><h4>Cambios y correos por mes</h4><p class="br-hint">Cambios detectados por el monitor para los expedientes seleccionados. “Enviado” es la confirmación del proveedor, no de lectura.</p>${table(['Mes','Cambios','Enviados','Pendientes','Revisar'],months.map(m=>`<tr><th scope="row">${esc(m.label)}</th><td>${m.total}</td><td>${m.sent}</td><td>${m.pending}</td><td>${m.review}</td></tr>`))}</section>
      <section class="br-section"><h4>Tareas abiertas</h4>${table(['Expediente','Próxima acción','Fecha prevista','Responsable','Acción'],pendingTasks.map(t=>{const w=rows.find(r=>r.watch.id===t.watch_id)?.watch;return `<tr><th scope="row">${esc(w?.label||'Sin nombre')}</th><td>${esc(t.title)}</td><td>${t.due_at&&Date.parse(t.due_at)<Date.now()?'<span class="br-tag warning">Vencida</span>':''}${esc(displayDate(t.due_at))}</td><td>${esc(t.assigned_to||w?.assigned_to||'Sin responsable')}</td><td><button type="button" class="br-text-button" data-br-open="${esc(t.watch_id)}">Abrir</button></td></tr>`;}),'No hay tareas abiertas en la selección.')}</section>
      <section class="br-section"><h4>Metas internas de formalización</h4><p class="br-hint">Hasta 30 días restantes o vencidas. El plazo se configura por expediente y debe confirmarse con la entidad.</p>${table(['Expediente','Emisión','Meta','Restantes','Acción'],near.sort((a,b)=>a.deadline.days-b.deadline.days).map(r=>`<tr><th scope="row">${esc(r.watch.label||'Sin nombre')}</th><td>${esc(displayDate(r.deadline.emittedDate))}</td><td>${esc(displayDate(r.deadline.deadline||r.deadline.date))}</td><td><span class="br-tag ${r.deadline.days<=0?'danger':'warning'}">${r.deadline.days<0?`${Math.abs(r.deadline.days)} días vencida`:`${r.deadline.days} días`}</span></td><td><button type="button" class="br-text-button" data-br-open="${esc(r.watch.id)}">Abrir expediente</button></td></tr>`),'No hay metas internas próximas a vencer en la selección.')}</section>
      <section class="br-section"><h4>Documentos por completar o renovar</h4>${table(['Expediente','Requisito','Estado','Vencimiento','Responsable','Acción'],docRows.map(({r,doc})=>`<tr><th scope="row">${esc(r.watch.label||'Sin nombre')}</th><td>${esc(doc.label||doc.id)}</td><td><span class="br-tag ${doc.expires_on&&doc.expires_on<today()?'danger':'warning'}">${doc.expires_on&&doc.expires_on<today()?'Vencido':({received:'Recibido, por revisar',pending:'Pendiente',approved:'Aprobado'})[doc.status]||'Pendiente'}</span></td><td>${esc(displayDate(doc.expires_on))}</td><td>${esc(doc.responsible||r.responsible)}</td><td><button type="button" class="br-text-button" data-br-open="${esc(r.watch.id)}">Revisar</button></td></tr>`),'No hay requisitos pendientes en las listas configuradas. Los expedientes sin modalidad deben configurarse primero.')}</section>
      <section class="br-section"><h4>Próximas acciones y alertas</h4>${table(['Expediente','Etapa','Pendientes','Responsable','Acción'],overdue.map(r=>`<tr><th scope="row">${esc(r.watch.label||'Sin nombre')}</th><td>${esc(stageLabel(r.profile.workflow_stage))}</td><td>${r.issues.map(i=>`<span class="br-tag ${i.kind}">${esc(i.text)}</span>`).join(' ')}</td><td>${esc(r.responsible)}</td><td><button type="button" class="br-text-button" data-br-open="${esc(r.watch.id)}">Gestionar</button></td></tr>`),'No hay pendientes operativos en la selección.')}</section>
      <section class="br-section"><h4>Construcción e inspecciones</h4>${table(['Expediente','Avance registrado','Presupuesto aprobado','Desembolsado','Inspecciones','Acción'],rows.filter(r=>r.profile.workflow_stage==='construction'||array(r.profile.construction?.inspections).length).map(r=>{const c=r.profile.construction||{};return `<tr><th scope="row">${esc(r.watch.label||'Sin nombre')}</th><td>${Math.min(100,Math.max(0,Number(c.progress)||0))}%</td><td>${esc(money(c.approved_budget))}</td><td>${esc(money(array(c.disbursements).reduce((a,v)=>a+(Number(v.amount)||0),0)))}</td><td>${array(c.inspections).length}</td><td><button type="button" class="br-text-button" data-br-open="${esc(r.watch.id)}">Ver obra</button></td></tr>`;}),'Todavía no hay obras o inspecciones registradas.')}</section>
      <p class="br-hint">Etapas, fechas y avances internos son registros de su empresa. Los estados BANHVI se conservan por separado.</p></div>`;
    host.querySelector('[data-br-filters]').onsubmit=event=>{event.preventDefault();const values=new FormData(event.currentTarget);filters.from=values.get('from');filters.to=values.get('to');filters.entity=values.get('entity');render();};
    host.querySelector('[data-br-reset]').onclick=()=>{Object.assign(filters,{from:'',to:'',entity:''});render();};
    host.querySelectorAll('[data-br-open]').forEach(button=>button.onclick=()=>settings.onOpen?.(button.dataset.brOpen));
    const exportButton=host.querySelector('[data-br-export]');if(exportButton)exportButton.onclick=exportCsv;
  }
  function exportCsv() {
    if(typeof settings.canExport==='function'?!settings.canExport():settings.canExport===false)return;
    const rows=getRows();
    if(!rows.length){settings.toast?.('No hay expedientes en esta selección.');return;}
    const headers=['Referencia','Caso BANHVI','Modalidad','Etapa interna','Entidad','Responsable','Días en etapa','Documentos aplicables','Documentos completos','Documentos vencidos','Fecha meta interna','Días restantes','Pendientes'];
    const cell=value=>`"${String(value??'').replace(/^[\s]*[=+\-@]/,m=>"'"+m).replace(/"/g,'""')}"`;
    const csv=[headers,...rows.map(r=>[r.watch.label,r.watch.case_number?`'${r.watch.case_number}`:'',modalityLabel(r.profile.modality),stageLabel(r.profile.workflow_stage),r.entity,r.responsible,r.daysInStage,r.docs.total,r.docs.complete,r.docs.expired,r.deadline&&!r.deadline.completed?r.deadline.deadline||r.deadline.date:'',r.deadline&&!r.deadline.completed?r.deadline.days:'',r.issues.map(i=>i.text).join(' · ')])].map(row=>row.map(cell).join(';')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8;'})),link=document.createElement('a');link.href=url;link.download=`bonoalerta-reporte-${today()}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);settings.toast?.('Reporte descargado.');
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
