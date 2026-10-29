(function (scope) {
  'use strict';
  const DAY = 86400000;
  const base = [
    {id:'identity',label:'Identificaciones del núcleo familiar'},
    {id:'income',label:'Constancias de ingresos'},
    {id:'family',label:'Documentos del núcleo familiar'},
    {id:'property',label:'Certificaciones de bienes y propiedad'},
    {id:'application',label:'Solicitud y formularios de la entidad'}
  ];
  const technical = [
    {id:'plans',label:'Planos o croquis aprobados'},
    {id:'budget',label:'Presupuesto de obra'},
    {id:'permit',label:'Permiso municipal de construcción'},
    {id:'technical',label:'Informe técnico y fotografías'},
    {id:'appraisal',label:'Avalúo de la propiedad'}
  ];
  const modalities = [
    {id:'own_lot',label:'Construcción en lote propio',requirements:[...base,...technical]},
    {id:'lot_construction',label:'Lote y construcción',requirements:[...base,{id:'lot_offer',label:'Opción de compra del lote'},...technical]},
    {id:'purchase',label:'Compra de vivienda existente',requirements:[...base,{id:'purchase_offer',label:'Opción de compra de vivienda'},{id:'appraisal',label:'Avalúo y revisión de la vivienda'}]},
    {id:'family_lot',label:'Construcción en terreno familiar',requirements:[...base,{id:'family_land',label:'Autorización y documentación del terreno familiar'},...technical]},
    {id:'ramt',label:'Reparación, ampliación o mejora (RAMT)',requirements:[...base,...technical,{id:'existing_home',label:'Diagnóstico de la vivienda existente'}]},
    {id:'special',label:'Programa especial',requirements:[...base,...technical,{id:'special_program',label:'Documentación específica del programa'}]}
  ];
  const stages = [
    {id:'prequalification',label:'Precalificación'}, {id:'documents',label:'Documentación'},
    {id:'entity_review',label:'Revisión de entidad'}, {id:'banhvi_review',label:'Revisión BANHVI'},
    {id:'emitted',label:'Emisión'}, {id:'formalization',label:'Formalización'},
    {id:'construction',label:'Construcción'}, {id:'closed',label:'Cerrado'}
  ];
  function parseDate(value) {
    if (typeof value !== 'string') return null;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const cr = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!iso && !cr) return null;
    const [year,month,day] = iso ? [+iso[1],+iso[2],+iso[3]] : [+cr[3],+cr[2],+cr[1]];
    const date = new Date(Date.UTC(year,month-1,day));
    return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day ? date.getTime()/DAY : null;
  }
  const isoDay = day => new Date(day*DAY).toISOString().slice(0,10);
  function todayISO(now = new Date()) {
    const date = now instanceof Date ? now : new Date(now);
    const parts = new Intl.DateTimeFormat('en-US',{timeZone:'America/Costa_Rica',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    const part = name => parts.find(p=>p.type===name).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function profileDefaults(watch={}) {
    return {watch_id:watch.id,organization_id:watch.organization_id,modality:'own_lot',workflow_stage:'prequalification',stage_entered_at:watch.created_at||null,financial_entity:'',deadline_days:90,emitted_on:null,formalized_on:null,notary:'',deed_signed_on:null,registry_presented_on:null,registry_reference:'',registered_on:null,checklist:[],prequalification:{},construction:{progress:0,inspections:[],milestones:[],disbursements:[],photos:[]},costs:[],stage_history:[]};
  }
  function requirementsFor(modality) {
    return (modalities.find(m=>m.id===modality)||modalities[0]).requirements.map(item=>({...item}));
  }
  function formalizationInfo(watch={},profile={},now=new Date()) {
    const stateDates=(Array.isArray(watch.last_states)?watch.last_states:[])
      .filter(s=>String(s.description||'').trim().toUpperCase()==='EMITIDO')
      .map(s=>parseDate(s.date)).filter(d=>d!==null);
    const override=parseDate(profile.emitted_on);
    const start=override!==null?override:stateDates.length?Math.max(...stateDates):null;
    if(start===null)return null;
    const raw=Number(profile.deadline_days??90);
    const totalDays=Number.isInteger(raw)&&raw>=1&&raw<=3650?raw:90;
    const today=parseDate(todayISO(now));
    const completed=Boolean(profile.formalized_on||profile.registered_on||['construction','closed'].includes(profile.workflow_stage)||
      (watch.last_states||[]).some(s=>/^(FORMALIZADO|FORMALIZADA)$/i.test(String(s.description||'').trim())));
    const end=parseDate(profile.formalized_on||profile.registered_on)||today;
    return {emittedDate:isoDay(start),date:isoDay(start+totalDays),deadline:isoDay(start+totalDays),days:start+totalDays-today,elapsed:Math.max(0,end-start),totalDays,completed,label:'Meta interna de formalización'};
  }
  function checklistStats(checklist=[],now=new Date()) {
    const today=parseDate(todayISO(now));
    const applicable=(Array.isArray(checklist)?checklist:[]).filter(d=>d.status!=='not_applicable');
    const complete=applicable.filter(d=>d.status==='approved'&&!(parseDate(d.expires_on)!==null&&parseDate(d.expires_on)<today)).length;
    const expired=applicable.filter(d=>parseDate(d.expires_on)!==null&&parseDate(d.expires_on)<today).length;
    return {total:applicable.length,complete,pending:applicable.length-complete,expired,percent:applicable.length?Math.round(complete/applicable.length*100):0};
  }
  function evaluatePrequalification(value={}) {
    const flags=[],missing=[];
    const questions={family_nucleus:'Confirmar núcleo familiar',adult_member:'Confirmar al menos un adulto',residency:'Confirmar nacionalidad o residencia legal',previous_bono:'Verificar bono anterior'};
    for(const [key,label] of Object.entries(questions)) {
      if(!['yes','no'].includes(value[key]))missing.push(label);
      else if(key==='previous_bono'?value[key]==='yes':value[key]==='no')flags.push(label);
    }
    if(!value.property_situation||value.property_situation==='unknown')missing.push('Verificar situación de propiedades');
    if(value.property_situation==='multiple')flags.push('Revisar las propiedades inscritas con la entidad');
    if(value.monthly_income==null||value.monthly_income==='')missing.push('Registrar ingresos familiares');
    const sourcedLimit=Number(value.income_limit)>0 && /^https:\/\//.test(value.source_url||'') && parseDate(value.verified_on)!==null;
    if(!sourcedLimit)missing.push('Verificar límite de ingresos vigente y su fuente');
    else if(Number(value.monthly_income)>Number(value.income_limit))flags.push('Ingresos superiores al límite de referencia registrado');
    return {status:flags.length?'review':missing.length?'incomplete':'ready',flags,missing,title:flags.length?'Requiere revisión de la entidad':missing.length?'Orientación pendiente de completar':'Información preliminar completa',disclaimer:'Orientación preliminar. La entidad autorizada y BANHVI determinan los requisitos y la elegibilidad.'};
  }
  scope.BonoCase={modalities,stages,requirementsFor,profileDefaults,formalizationInfo,checklistStats,evaluatePrequalification,parseDate,todayISO,isoDay};
})(globalThis);
