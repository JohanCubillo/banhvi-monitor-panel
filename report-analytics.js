/* Pure calculations over the current company's already filtered report rows. */
(function(scope){
  'use strict';
  const C=()=>scope.BonoCase||{},array=v=>Array.isArray(v)?v:[];
  const normal=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
  const validStates=row=>array(row.watch.last_states).filter(s=>C().parseDate?.(s.date)!=null&&String(s.description||'').trim());
  const observed=(row,pattern)=>validStates(row).some(s=>pattern.test(normal(s.description)));
  const hasStates=row=>validStates(row).length>0;
  const chosen=row=>row.watch.last_error==='CASE_SELECTION_REQUIRED';
  const technical=row=>Boolean(row.watch.last_error&&!['CASE_SELECTION_REQUIRED','CASE_NOT_FOUND','CASE_IDENTITY_CHANGED'].includes(row.watch.last_error));
  function ageHours(row,now=Date.now()){
    const timestamp=Date.parse(row.watch.last_success_at);
    return Number.isFinite(timestamp)&&timestamp<=Number(now)?(Number(now)-timestamp)/3600000:null;
  }
  const complete=row=>Boolean(C().formalizationComplete?.(row.watch,row.profile));
  function deadline(row,now=Date.now()){return row.deadline===undefined?C().formalizationInfo?.(row.watch,row.profile,new Date(now)):row.deadline;}
  function health(row,now=Date.now()){
    if(technical(row))return 'error';if(chosen(row))return 'choose';
    if(row.watch.last_error==='CASE_NOT_FOUND')return 'notfound';if(row.watch.last_error==='CASE_IDENTITY_CHANGED')return 'identity';
    if(!row.watch.enabled)return 'paused';
    if(!hasStates(row))return 'never';const age=ageHours(row,now);
    return age===null?'unknown':age>24?'stale':'fresh';
  }
  const healthLabels={error:'Fallo técnico de lectura',choose:'Casos por revisar o elegir',notfound:'Sin resultados en la última búsqueda',identity:'Caso vinculado por revisar',paused:'Monitoreo pausado',never:'Sin consulta guardada',unknown:'Fecha de consulta por revisar',stale:'Consulta de hace más de 24 h',fresh:'Consulta en las últimas 24 h'};
  const segments={
    overdue:'Meta interna vencida',due5:'Meta: faltan 0–5 días',due10:'Meta: faltan 6–10 días',withstates:'Con historial BANHVI consultado',withoutstates:'Sin historial BANHVI guardado',stale:'Monitoreo activo con último éxito de hace más de 24 h',cycle:'Con fechas válidas de emisión y formalización',
    emitted_pending:'Emitidos pendientes de formalizar',formalized:'Formalización completada',
    'health:error':healthLabels.error,'health:choose':healthLabels.choose,'health:never':healthLabels.never,
    'health:notfound':healthLabels.notfound,'health:identity':healthLabels.identity,
    'health:stale':healthLabels.stale,'health:fresh':healthLabels.fresh,'health:unknown':healthLabels.unknown,'health:paused':healthLabels.paused,
    'hit:emitted':'Historial con EMITIDO','hit:formalized':'Historial con FORMALIZADO','hit:paid':'Historial con PAGADO','hit:liquidated':'Historial con CASO LIQUIDADO'
  };
  const hitPatterns={emitted:/^EMITIDO$/,formalized:/^FORMALIZAD[OA]$/,paid:/^PAGAD[OA]$/,liquidated:/^CASO LIQUIDADO$/};
  function sourceReview(row){
    const states=validStates(row);if(!states.length)return false;const last=Math.max(...states.map(s=>C().parseDate(s.date)));
    return states.some(s=>C().parseDate(s.date)===last&&/ANOMALIA|DEVUELT[OA]|RECHAZAD[OA]|SUBSANAR/.test(normal(s.description))&&!/SUBSANAD[OA]|CORREGID[OA]|RESUELT[OA]|SIN ANOMALIA|NO PRESENTA ANOMALIA/.test(normal(s.description)));
  }
  segments.observations='Observaciones en la última fecha BANHVI';
  function matches(row,key,now=Date.now()){
    if(!key)return true;if(key==='withstates')return hasStates(row);if(key==='withoutstates')return !hasStates(row);if(key==='stale')return Boolean(row.watch.enabled&&hasStates(row)&&ageHours(row,now)>24);if(key==='cycle')return cycleDays(row,now)!==null;if(key==='observations')return sourceReview(row);if(key.startsWith('health:'))return health(row,now)===key.slice(7);
    if(key.startsWith('hit:'))return Boolean(hitPatterns[key.slice(4)]&&observed(row,hitPatterns[key.slice(4)]));
    const info=deadline(row,now),pending=info&&!complete(row);
    return key==='formalized'?complete(row):key==='emitted_pending'?Boolean(pending):key==='overdue'?pending&&info.days<0:key==='due5'?pending&&info.days>=0&&info.days<=5:key==='due10'?pending&&info.days>=6&&info.days<=10:false;
  }
  function cycleDays(row,now=Date.now()){
    const today=C().parseDate?.(C().todayISO?.(new Date(now)));
    const states=validStates(row).filter(s=>today!=null&&C().parseDate(s.date)<=today),emitted=states.filter(s=>hitPatterns.emitted.test(normal(s.description))).map(s=>C().parseDate(s.date));
    if(!emitted.length)return null;const start=Math.max(...emitted);
    const end=states.filter(s=>hitPatterns.formalized.test(normal(s.description))).map(s=>C().parseDate(s.date)).filter(d=>d>=start);
    return end.length?Math.min(...end)-start:null;
  }
  function action(row,now=Date.now()){
    const info=deadline(row,now);
    if(info&&!complete(row)&&info.days<0)return{rank:0,label:'Revisar meta interna vencida',detail:`${Math.abs(info.days)} días después de la meta`};
    if(info&&!complete(row)&&info.days<=5)return{rank:1,label:'Preparar formalización',detail:`Faltan ${info.days} días para la meta interna`};
    if(info&&!complete(row)&&info.days<=10)return{rank:2,label:'Coordinar formalización',detail:`Faltan ${info.days} días para la meta interna`};
    if(sourceReview(row))return{rank:3,label:'Revisar observación de BANHVI',detail:'La última fecha consultada contiene una observación o devolución'};
    if(technical(row))return{rank:3,label:'Revisar lectura BANHVI',detail:'El último intento falló; conservar el resultado anterior'};
    if(chosen(row))return{rank:4,label:'Revisar o elegir caso',detail:'Continuar la selección desde el expediente'};
    if(row.watch.last_error==='CASE_IDENTITY_CHANGED')return{rank:4,label:'Revisar caso vinculado',detail:'El portal abrió un caso distinto del vinculado'};
    if(row.watch.last_error==='CASE_NOT_FOUND')return{rank:5,label:'Verificar cédula y registro',detail:'BANHVI no devolvió resultados en la última búsqueda'};
    if(row.watch.enabled&&!hasStates(row))return{rank:5,label:'Completar primera consulta',detail:'Todavía no hay estados obtenidos por el monitor'};
    if(row.watch.enabled&&ageHours(row,now)>24)return{rank:6,label:'Actualizar consulta',detail:'Último éxito hace más de 24 horas'};
    if(row.watch.enabled&&hasStates(row)&&ageHours(row,now)===null)return{rank:6,label:'Revisar fecha de consulta',detail:'La fecha del último éxito falta o no es válida'};
    if(row.docs?.expired||array(row.issues).some(i=>i.kind==='danger'))return{rank:7,label:'Resolver pendientes urgentes',detail:array(row.issues).filter(i=>i.kind==='danger').map(i=>i.text).join(' · ')};
    if(array(row.issues).some(i=>i.kind==='warning'))return{rank:8,label:'Completar gestión interna',detail:array(row.issues).filter(i=>i.kind==='warning').map(i=>i.text).join(' · ')};
    return null;
  }
  function analyze(rows,now=Date.now()){
    const counts={total:rows.length,active:rows.filter(r=>r.watch.enabled).length,withStates:rows.filter(hasStates).length,
      technical:rows.filter(technical).length,choose:rows.filter(chosen).length,notfound:rows.filter(r=>r.watch.last_error==='CASE_NOT_FOUND').length,observations:rows.filter(sourceReview).length,never:rows.filter(r=>!hasStates(r)).length,
      stale:rows.filter(r=>r.watch.enabled&&hasStates(r)&&ageHours(r,now)>24).length,
      overdue:rows.filter(r=>matches(r,'overdue',now)).length,due5:rows.filter(r=>matches(r,'due5',now)).length,due10:rows.filter(r=>matches(r,'due10',now)).length,
      completed:rows.filter(complete).length,emittedPending:rows.filter(r=>matches(r,'emitted_pending',now)).length};
    const healthSeries=Object.entries(healthLabels).map(([key,label])=>({key:'health:'+key,label,count:rows.filter(r=>health(r,now)===key).length}));
    const milestones=Object.entries(hitPatterns).map(([key,pattern])=>({key:'hit:'+key,label:({emitted:'EMITIDO',formalized:'FORMALIZADO',paid:'PAGADO',liquidated:'CASO LIQUIDADO'})[key],count:rows.filter(r=>observed(r,pattern)).length}));
    const cycles=rows.map(row=>cycleDays(row,now)).filter(n=>n!==null).sort((a,b)=>a-b),mid=Math.floor(cycles.length/2);
    const cycle={sample:cycles.length,average:cycles.length?cycles.reduce((a,b)=>a+b,0)/cycles.length:null,median:cycles.length?cycles.length%2?cycles[mid]:(cycles[mid-1]+cycles[mid])/2:null};
    const manual={urgent:0,high:1,normal:2,low:3};
    const actions=rows.map(row=>({row,action:action(row,now)})).filter(item=>item.action).sort((a,b)=>a.action.rank-b.action.rank||(manual[a.row.watch.priority]??2)-(manual[b.row.watch.priority]??2)||(Date.parse(a.row.watch.last_attempt_at)||0)-(Date.parse(b.row.watch.last_attempt_at)||0)||String(a.row.watch.id).localeCompare(String(b.row.watch.id)));
    function breakdown(key){
      const groups=new Map();for(const row of rows){const label=String(row[key]||'Sin registrar');if(!groups.has(label))groups.set(label,[]);groups.get(label).push(row);}
      return [...groups].map(([label,items])=>({label,total:items.length,completed:items.filter(complete).length,overdue:items.filter(r=>matches(r,'overdue',now)).length,technical:items.filter(technical).length,choose:items.filter(chosen).length,withoutRecent:items.filter(r=>!hasStates(r)||ageHours(r,now)===null||ageHours(r,now)>24).length})).sort((a,b)=>b.total-a.total||a.label.localeCompare(b.label));
    }
    return{counts,healthSeries,milestones,cycle,actions,entities:breakdown('entity'),responsibles:breakdown('responsible')};
  }
  scope.BonoAnalytics={analyze,matches,health,healthLabels,segments,hasStates,ageHours,cycleDays,action};
})(globalThis);
