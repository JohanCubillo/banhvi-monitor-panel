/* Workbook data is parsed locally; saving requires an explicit organization-scoped confirmation. */
(function(scope){
  'use strict';
  const MAX_ROWS=3000,MAX_CASES=1000,MAX_BYTES=5*1024*1024;
  const aliases={name:['NOMBRE','BENEFICIARIO','REFERENCIA'],cedula:['CEDULA','CÉDULA'],financial_entity:['ENTIDAD'],reported_status:['ESTADO EN BANHVI','ESTADO BANHVI'],reported_status_on:['FECHA DE ESTADO BANHVI','FECHA ESTADO BANHVI'],company_status:['ESTADO EMPRESA'],bono_type:['TIPO DE BONO','TIPO BONO'],zone:['ZONA'],submitted_on:['MES DE INGRESO','FECHA DE INGRESO','FECHA INGRESO'],observations:['OBSERVACION','OBSERVACIONES'],phone:['TELEFONO','TELÉFONO'],internal_color:['COLOR INTERNO Y CODIGO'],external_color:['COLOR EXTERNO Y CODIGO'],house_model:['MODELO DE CASA'],gutter_color:['COLOR CANOA'],window_frame_color:['COLOR MARCO DE VENTANA'],pvc_color:['COLOR TABLILLA PVC'],quote_notes:['OBSERVACION COTIZACION'],construction_started_on:['INICIO DE CONSTRUCCION'],construction_completed_on:['FINALIZACION DE CONSTRUCCION'],inspections:['INSPECCIONES REALIZADAS'],task_text:['TAREAS'],task_due_on:['FECHA DE TAREA']};
  const dateKeys=new Set(['reported_status_on','submitted_on','construction_started_on','construction_completed_on','task_due_on']);
  const longKeys=new Set(['observations','quote_notes','inspections','task_text']);
  const normalized=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const person=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
  const storedPerson=value=>String(value??'').trim().toLocaleLowerCase().replace(/\s+/g,' ');
  const text=cell=>cell&&typeof cell==='object'&&'v'in cell?String(cell.w??cell.v??'').trim():String(cell??'').trim();
  const raw=cell=>cell&&typeof cell==='object'&&'v'in cell?cell.v:cell;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const lookup=new Map(Object.entries(aliases).flatMap(([key,values])=>values.map(value=>[normalized(value),key])));
  function validDate(year,month,day){const n=new Date(Date.UTC(year,month-1,day));return year>=1900&&year<=2200&&n.getUTCFullYear()===year&&n.getUTCMonth()===month-1&&n.getUTCDate()===day?`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:null;}
  function dateValue(cell,date1904=false){
    const v=raw(cell),original=text(cell);
    if(v===null||v===undefined||v==='')return{date:null,original:''};
    if(typeof v==='number'&&Number.isFinite(v)&&v>=(date1904?0:1)&&v<110000){const d=scope.XLSX.SSF.parse_date_code(v,{date1904});return{date:d?validDate(d.y,d.m,d.d):null,original};}
    if(v instanceof Date)return{date:validDate(v.getUTCFullYear(),v.getUTCMonth()+1,v.getUTCDate()),original};
    let m=String(v).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if(m)return{date:validDate(+m[1],+m[2],+m[3]),original};
    m=String(v).trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    return{date:m?validDate(+m[3],+m[2],+m[1]):null,original};
  }
  function identity(cell){
    const v=raw(cell);if(v===null||v===undefined||v==='')return'';
    if(typeof v==='number'){if(!Number.isSafeInteger(v)||v<0)return String(v);const displayed=text(cell);return /^0\d+$/.test(displayed)?displayed:String(v);}
    return String(v).trim().replace(/[\s.-]/g,'');
  }
  function checkZip(buffer){
    const bytes=new Uint8Array(buffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(view.getUint32(i,true)===0x06054b50&&i+22+view.getUint16(i+20,true)===bytes.length){end=i;break;}}
    if(end<0)throw Error('El archivo no es un XLSX válido. Usá un archivo .xlsx sin contraseña.');
    const entries=view.getUint16(end+10,true),directory=view.getUint32(end+16,true);let offset=directory,total=0;
    if(entries>2000||entries===65535||view.getUint16(end+4,true)!==0)throw Error('El libro supera los límites de lectura. Separá las hojas en archivos más pequeños.');
    for(let i=0;i<entries;i++){
      if(offset+46>bytes.length||view.getUint32(offset,true)!==0x02014b50)throw Error('El XLSX está incompleto o dañado.');
      const flags=view.getUint16(offset+8,true),size=view.getUint32(offset+24,true),nameLength=view.getUint16(offset+28,true),extra=view.getUint16(offset+30,true),comment=view.getUint16(offset+32,true);
      const name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+nameLength));total+=size;
      if(flags&1||/vbaProject|externalLinks\//i.test(name))throw Error('Usá un XLSX sin macros, enlaces externos ni contraseña.');
      if(size>20*1024*1024||total>40*1024*1024||size===0xffffffff)throw Error('El contenido expandido del libro es demasiado grande. Separá el archivo.');
      offset+=46+nameLength+extra+comment;if(offset>bytes.length)throw Error('El XLSX está incompleto.');
    }
  }
  function csvMatrix(input){
    const source=input.replace(/^\ufeff/,'');const first=source.split(/\r?\n/,1)[0];const separator=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';
    const rows=[],line=[];let field='',quoted=false;
    for(let i=0;i<source.length;i++){const c=source[i];if(c==='"'){if(quoted&&source[i+1]==='"'){field+='"';i++;}else if(!field||quoted)quoted=!quoted;else field+=c;}
      else if(!quoted&&(c===separator||c==='\r'||c==='\n')){line.push(field);field='';if(c!==separator){rows.push(line.splice(0));if(c==='\r'&&source[i+1]==='\n')i++;}}
      else field+=c;
      if(rows.length>MAX_ROWS+30)throw Error('El CSV supera 3.000 filas. Separá el archivo.');
    }
    if(quoted)throw Error('El CSV tiene comillas sin cerrar. Revisá esa fila antes de subirlo.');
    if(field||line.length){line.push(field);rows.push(line);}return rows;
  }
  async function readFile(file){
    if(!file||file.size>MAX_BYTES)throw Error('Usá un archivo XLSX o CSV de hasta 5 MB.');
    if(/\.csv$/i.test(file.name))return{sheets:[{name:'CSV',matrix:csvMatrix(await file.text())}],fileName:file.name};
    if(!/\.xlsx$/i.test(file.name))throw Error('Elegí un archivo .xlsx o .csv.');
    if(!scope.XLSX)throw Error('No se pudo cargar el lector de Excel. Actualizá la página e intentá de nuevo.');
    const buffer=await file.arrayBuffer();checkZip(buffer);
    const book=scope.XLSX.read(new Uint8Array(buffer),{type:'array',cellFormula:true,cellHTML:false,cellNF:true,cellText:true,cellDates:false,sheetRows:MAX_ROWS+31,WTF:true});
    const sheets=book.SheetNames.map(name=>{
      const sheet=book.Sheets[name],ref=sheet['!fullref']||sheet['!ref'];if(!ref)return{name,matrix:[]};
      const range=scope.XLSX.utils.decode_range(ref);if(range.e.r>MAX_ROWS+30||range.e.c>100)throw Error(`La hoja ${name} supera los límites de lectura (3.000 filas y 100 columnas).`);
      const matrix=[];for(let row=0;row<=range.e.r;row++){const cells=[];for(let col=0;col<=range.e.c;col++)cells.push(sheet[scope.XLSX.utils.encode_cell({r:row,c:col})]||null);matrix.push(cells);}return{name,matrix};
    });return{sheets,date1904:!!book.Workbook?.WBProps?.date1904,fileName:file.name};
  }
  function parseRows(book){
    const records=[],sheets=[];let skipped=0;
    for(const sheet of book.sheets){
      let header=-1,columns={};
      for(let r=0;r<Math.min(30,sheet.matrix.length);r++){
        const candidate={};sheet.matrix[r].forEach((cell,index)=>{const key=lookup.get(normalized(text(cell)));if(key&&candidate[key]===undefined)candidate[key]=index;});
        if(candidate.name!==undefined&&(candidate.cedula!==undefined||candidate.house_model!==undefined||candidate.internal_color!==undefined)){header=r;columns=candidate;break;}
      }
      if(header<0){sheets.push({name:sheet.name,count:0,unsupported:true});continue;}
      const kind=columns.cedula===undefined?'detail':'case';let count=0;
      for(let r=header+1;r<sheet.matrix.length;r++){
        const cells=sheet.matrix[r];if(!cells.some(c=>text(c))){skipped++;continue;}
        const label=text(cells[columns.name]),idCell=cells[columns.cedula];
        if(['NOMBRE','BENEFICIARIO'].includes(normalized(label))||/^C.?DULA$/.test(normalized(text(idCell)))){skipped++;continue;}
        const intake={category:kind==='detail'?'follow_up':/ART\s*59/i.test(sheet.name)?'art59':columns.task_text!==undefined?'follow_up':'ordinary_special',sources:[{sheet:sheet.name,row:r+1}]},warnings=[],errors=[];
        for(const [key,index] of Object.entries(columns)){
          if(['name','cedula','financial_entity'].includes(key))continue;
          const cell=cells[index],value=text(cell);
          if(dateKeys.has(key)){const d=dateValue(cell,book.date1904);if(d.date)intake[key]=d.date;else if(d.original){intake[key+'_text']=d.original;warnings.push(`Fecha sin confirmar: ${key}`);}}
          else if(value)intake[key]=value;
          if(key==='phone'&&value){const digits=String(raw(cell)??'').replace(/\D/g,'');if(digits.length!==8&&!(digits.length===11&&digits.startsWith('506')))warnings.push('Revisá el teléfono; el valor original se conserva sin truncarlo.');}
          if(cell?.f)warnings.push(`Valor calculado guardado en ${key}; no se ejecutó la fórmula.`);
        }
        const cedula=kind==='case'?identity(idCell):'';
        if(!label)errors.push('Falta el nombre');
        if(kind==='case'&&!/^\d{9,12}$/.test(cedula))errors.push(cedula?'Cédula inválida: revisá su longitud y contenido':'Falta la cédula');
        if(kind==='case'&&idCell?.f)errors.push('La cédula contiene una fórmula; escribila como texto');
        if(label.length>240)errors.push('El nombre supera 240 caracteres');
        if(text(cells[columns.financial_entity]).length>160)errors.push('La entidad supera 160 caracteres');
        if(normalized(text(cells[columns.financial_entity]))==='COOPEANE')warnings.push('La entidad dice COOPEANE; confirmá si corresponde a COOPENAE antes de corregirla.');
        for(const [key,value] of Object.entries(intake)){if(typeof value==='string'&&value.length>(longKeys.has(key)?4000:key==='company_status'?1000:160))errors.push(`Texto demasiado largo: ${key}`);}
        records.push({key:`${sheets.length}:${r+1}`,kind,sheet:sheet.name,row:r+1,label,cedula,financial_entity:text(cells[columns.financial_entity]),intake_data:intake,warnings,errors});count++;
        if(records.length>MAX_ROWS)throw Error('El libro supera 3.000 registros. Separá el archivo.');
      }
      sheets.push({name:sheet.name,count,kind,header:header+1});
    }
    if(!records.length)throw Error('No encontré hojas con nombre y cédula, o con detalles de vivienda. Revisá los encabezados.');
    return{records,sheets,skipped,fileName:book.fileName};
  }
  function analyze(parsed,{existing=[],includeDetails=false,overrides={},detailLinks={},mode='new_only',enabled=true}={}){
    const records=parsed.records.map(original=>{const row=clone(original);if(Object.hasOwn(overrides,row.key)){row.cedula=String(overrides[row.key]).trim().replace(/[\s.-]/g,'');row.errors=row.errors.filter(e=>!/^Cédula|^Falta la cédula/.test(e));if(!/^\d{9,12}$/.test(row.cedula))row.errors.push('Cédula inválida: revisá su longitud y contenido');}return row;});
    const cases=records.filter(r=>r.kind==='case'),groups=new Map(),details=records.filter(r=>r.kind==='detail');
    for(const row of cases)if(!row.errors.length){if(!groups.has(row.cedula))groups.set(row.cedula,[]);groups.get(row.cedula).push(row);}
    const payload=[],caseByName=new Map(),existingIds=new Map(existing.map(w=>[w.cedula,w]));
    for(const [id,rows] of groups){
      if(new Set(rows.map(r=>person(r.label))).size>1){rows.forEach(r=>r.errors.push('La misma cédula tiene nombres distintos en el archivo'));continue;}
      const main=rows.find(r=>r.intake_data.category!=='follow_up')||rows[0],result={key:main.key,cedula:id,label:main.label,financial_entity:main.financial_entity,intake_data:clone(main.intake_data),enabled};let conflict=false;
      for(const row of rows.filter(r=>r!==main)){
        for(const [key,value] of Object.entries(row.intake_data)){
          if(key==='sources'){result.intake_data.sources.push(...value);continue;}if(key==='category')continue;
          if(!result.intake_data[key])result.intake_data[key]=value;
          else if(result.intake_data[key]!==value){if(longKeys.has(key))result.intake_data[key]+=`\n${row.sheet}, fila ${row.row}: ${value}`;else if(key==='phone')result.intake_data[key]+=` / ${value}`;else{conflict=true;rows.forEach(r=>r.errors.push(`Valores diferentes para ${key}; revisá las filas de esta cédula`));}}
        }
        if(row.financial_entity&&result.financial_entity&&row.financial_entity!==result.financial_entity){conflict=true;rows.forEach(r=>r.errors.push('Entidades distintas para la misma cédula'));}
        else if(!result.financial_entity)result.financial_entity=row.financial_entity;
      }
      const old=existingIds.get(id);if(old&&storedPerson(old.label)!==storedPerson(result.label)){conflict=true;rows.forEach(r=>r.errors.push('La cédula ya existe con otro nombre en esta empresa; revisá también los acentos'));
      }
      if(result.intake_data.sources.length>12||Object.entries(result.intake_data).some(([k,v])=>typeof v==='string'&&v.length>(longKeys.has(k)?4000:k==='company_status'?1000:160))){conflict=true;rows.forEach(r=>r.errors.push('Los datos combinados superan el tamaño permitido'));}
      if(conflict)continue;
      rows.forEach(r=>{r.status=old?(mode==='fill_missing'?'Completar vacíos':'Ya existe; se omitirá'):'Nuevo';r.merged=rows.length>1;});payload.push(result);
      const key=person(result.label);if(!caseByName.has(key))caseByName.set(key,[]);caseByName.get(key).push(result);
    }
    for(const old of existing){const key=person(old.label);if(!caseByName.has(key))caseByName.set(key,[]);if(!caseByName.get(key).some(r=>r.cedula===old.cedula))caseByName.get(key).push({key:`existing:${old.id}`,cedula:old.cedula,label:old.label,financial_entity:'',intake_data:{category:'follow_up',sources:[]},enabled});}
    const detailNames=new Map();details.forEach(row=>{const key=person(row.label);if(!detailNames.has(key))detailNames.set(key,[]);detailNames.get(key).push(row);});
    for(const detail of details){
      const explicit=detailLinks[detail.key];const matches=explicit?[...caseByName.values()].flat().filter(r=>r.cedula===explicit).filter((r,i,a)=>a.findIndex(x=>x.cedula===r.cedula)===i):caseByName.get(person(detail.label))||[];
      if((!explicit&&detailNames.get(person(detail.label)).length!==1)||matches.length!==1){detail.errors.push(matches.length?'Nombre repetido: elegí la cédula en el archivo antes de asociar':'No hay una coincidencia única; agregá la cédula en el archivo');continue;}
      detail.candidate=matches[0].cedula;detail.status=includeDetails?'Detalle asociado por nombre revisado':'Coincidencia por nombre; pendiente de confirmación';
      if(!includeDetails||detail.errors.length)continue;
      const candidate=matches[0],oldIndex=payload.findIndex(r=>r.cedula===candidate.cedula),target=clone(oldIndex>=0?payload[oldIndex]:candidate);let conflict=false;
      for(const [key,value] of Object.entries(detail.intake_data)){
        if(key==='category'||key==='sources')continue;if(!target.intake_data[key])target.intake_data[key]=value;
        else if(target.intake_data[key]!==value){detail.errors.push(`Revisá ${key}: ya hay otro valor para este caso`);conflict=true;}
      }
      if(!conflict){
        target.intake_data.sources.push(...detail.intake_data.sources);
        if(target.intake_data.sources.length>12||Object.entries(target.intake_data).some(([k,v])=>typeof v==='string'&&v.length>(longKeys.has(k)?4000:k==='company_status'?1000:160))||encodeURIComponent(JSON.stringify(target.intake_data)).replace(/%[A-F\d]{2}/gi,'x').length>38000){detail.errors.push('Los detalles combinados superan el tamaño o las 12 referencias permitidas');conflict=true;}
        if(!conflict){if(oldIndex<0)payload.push(target);else payload[oldIndex]=target;}
      }
      if(conflict)detail.status='Detalle sin asociar por conflicto';
    }
    for(let i=payload.length-1;i>=0;i--){if(encodeURIComponent(JSON.stringify(payload[i].intake_data)).replace(/%[A-F\d]{2}/gi,'x').length>38000){const id=payload[i].cedula;records.filter(r=>r.cedula===id).forEach(r=>r.errors.push('Los datos combinados son demasiado extensos'));payload.splice(i,1);}}
    records.forEach(r=>{if(r.errors.length)r.status='Revisar';});
    const ready=payload.filter(r=>!existingIds.has(r.cedula)||mode==='fill_missing');
    return{records,payload,newCount:payload.filter(r=>!existingIds.has(r.cedula)).length,existingCount:payload.filter(r=>existingIds.has(r.cedula)).length,reviewCount:records.filter(r=>r.errors.length).length,detailCandidates:details.filter(r=>r.candidate&&!r.errors.length).length,readyCount:ready.length};
  }
  function downloadCsv(rows,name){const safe=value=>{let s=String(value??'');if(/^\s*[=+\-@]|^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};const content='\ufeff'+rows.map(row=>row.map(safe).join(';')).join('\r\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
  function mount({client,getContext,onImported=async()=>{},toast=()=>{}}){
    const dialog=document.createElement('dialog');dialog.id='workbook-import-dialog';dialog.className='bi-dialog';document.body.append(dialog);
    let parsed=null,analysis=null,snapshot=null,mode='new_only',includeDetails=false,enabled=true,busy=false,revision=0,page=0,onlyErrors=false,selectedSheet='',overrides={},detailLinks={},outcome=null;
    const context=()=>getContext?.()||{};
    function matchingContext(){const ctx=context();return !!snapshot&&ctx.organization?.id===snapshot.id&&ctx.organization?.active&&ctx.userId===snapshot.userId&&['owner','admin'].includes(ctx.membership?.role);}
    const statusNode=()=>dialog.querySelector('[data-bi-message]');
    function message(value,error=false){const node=statusNode();if(node){node.textContent=value;node.classList.toggle('error',error);}}
    function recompute(){analysis=analyze(parsed,{existing:snapshot.existing,includeDetails,overrides,detailLinks,mode,enabled});}
    function render(){
      if(!parsed)return;recompute();
      const visible=analysis.records.filter(row=>(!selectedSheet||row.sheet===selectedSheet)&&(!onlyErrors||row.errors.length));
      const pages=Math.max(1,Math.ceil(visible.length/40));page=Math.min(page,pages-1);
      const choices=[...new Map([...analysis.payload,...snapshot.existing].filter(row=>/^\d{9,12}$/.test(row.cedula)).map(row=>[row.cedula,row])).values()];
      const rows=visible.slice(page*40,page*40+40).map(row=>{
        const info=[...row.errors,...row.warnings].join(' · '),id=row.kind==='case'?`<input aria-label="Cédula ${escape(row.key)}" data-bi-id="${escape(row.key)}" value="${escape(row.cedula)}" inputmode="numeric" maxlength="24">`:`<select aria-label="Asociar detalle ${escape(row.key)}" data-bi-link="${escape(row.key)}"><option value="">${row.candidate?'Coincidencia: '+escape(row.candidate):'Elegir caso por cédula'}</option>${choices.map(choice=>`<option value="${escape(choice.cedula)}" ${detailLinks[row.key]===choice.cedula?'selected':''}>${escape(choice.cedula)} · ${escape(choice.label)}</option>`).join('')}</select>`;
        return`<tr class="${row.errors.length?'bi-review':''}"><td>${escape(row.sheet)}<small>Fila ${row.row}</small></td><td>${escape(row.label)}</td><td>${id}</td><td>${escape(row.status||'Pendiente')}<small>${escape(info||'Sin observaciones')}</small></td></tr>`;
      }).join('');
      const capacity=Math.max(0,snapshot.maxCases-snapshot.existing.length),tooMany=analysis.payload.length>MAX_CASES,overQuota=analysis.newCount>capacity;
      dialog.innerHTML=`<div class="bi-head"><div><p class="eyebrow">IMPORTACIÓN DE CASOS</p><h3>Revisar Excel o CSV</h3><p><strong>Empresa: ${escape(snapshot.name)}</strong> · ${escape(parsed.fileName)}</p></div><button type="button" class="icon-button" data-bi-close aria-label="Cerrar importación" ${busy?'disabled':''}>×</button></div><div class="bi-body"><p class="form-note">Se guardarán datos sólo en esta empresa. Los estados de la planilla se conservan como referencia histórica; el monitor mantiene sus consultas oficiales.</p><div class="bi-kpis"><article><strong>${analysis.newCount}</strong><span>casos nuevos</span></article><article><strong>${analysis.existingCount}</strong><span>ya registrados</span></article><article><strong>${analysis.reviewCount}</strong><span>filas por revisar</span></article><article><strong>${analysis.detailCandidates}</strong><span>detalles asociables</span></article></div><div class="bi-controls"><label>Registros existentes<select data-bi-mode ${busy?'disabled':''}><option value="new_only" ${mode==='new_only'?'selected':''}>Omitir; conservar los datos actuales</option><option value="fill_missing" ${mode==='fill_missing'?'selected':''}>Completar únicamente campos vacíos</option></select></label><label>Hoja<select data-bi-sheet><option value="">Todas las hojas</option>${parsed.sheets.map(sheet=>`<option value="${escape(sheet.name)}" ${selectedSheet===sheet.name?'selected':''}>${escape(sheet.name)} (${sheet.count})${sheet.unsupported?' · no reconocida':''}</option>`).join('')}</select></label></div><div class="bi-checks"><label><input type="checkbox" data-bi-details ${includeDetails?'checked':''} ${busy?'disabled':''}> Revisé las coincidencias por nombre y quiero asociar los detalles de vivienda.</label><label><input type="checkbox" data-bi-enabled ${enabled?'checked':''} ${busy?'disabled':''}> Iniciar monitoreo BANHVI para los casos nuevos.</label><label><input type="checkbox" data-bi-errors ${onlyErrors?'checked':''}> Ver sólo filas por revisar</label></div><p class="bi-notice">Las filas con errores quedan fuera de la carga. Podés corregir su cédula aquí o descargar la revisión para completar el archivo. Un nombre sin coincidencia única requiere elegir su caso; no se asocia por posición.</p>${overQuota?`<p class="bi-notice error">La empresa tiene cupo para ${capacity} casos nuevos y esta carga contiene ${analysis.newCount}. Revisá su capacidad antes de guardar.</p>`:''}${tooMany?'<p class="bi-notice error">Cada carga admite hasta 1.000 cédulas. Separá el archivo.</p>':''}<div class="bi-table-wrap"><table><thead><tr><th>Origen</th><th>Persona</th><th>Cédula o asociación</th><th>Revisión</th></tr></thead><tbody>${rows||'<tr><td colspan="4">No hay filas para este filtro.</td></tr>'}</tbody></table></div><div class="bi-pagination"><button type="button" class="ghost" data-bi-prev ${page===0?'disabled':''}>Anterior</button><span>Página ${page+1} de ${pages} · ${visible.length} filas</span><button type="button" class="ghost" data-bi-next ${page===pages-1?'disabled':''}>Siguiente</button></div><p data-bi-message class="message" role="status">${outcome?escape(outcome):!snapshot.intakeAvailable?'Falta activar la actualización de importación en Supabase antes de guardar.':''}</p></div><div class="bi-footer"><button type="button" class="ghost" data-bi-export>Descargar revisión CSV</button><button type="button" class="ghost" data-bi-close ${busy?'disabled':''}>Cancelar</button><button type="button" class="primary compact" data-bi-confirm ${busy||outcome||!snapshot.intakeAvailable||overQuota||tooMany||!analysis.payload.length?'disabled':''}>${busy?'Guardando…':`Confirmar carga en ${escape(snapshot.name)}`}</button></div>`;
    }
    function close(){if(busy)return;revision++;dialog.close();parsed=null;analysis=null;snapshot=null;outcome=null;dialog.innerHTML='';}
    async function open(file){
      const ctx=context();if(!ctx.organization?.active||!['owner','admin'].includes(ctx.membership?.role)){toast('Tu cuenta no puede importar casos en esta empresa.');return;}
      const token=++revision;snapshot={id:ctx.organization.id,name:ctx.organization.name,maxCases:ctx.organization.max_cases||0,userId:ctx.userId,existing:clone(ctx.watches||[]),intakeAvailable:!!ctx.intakeAvailable};
      mode='new_only';includeDetails=false;enabled=true;page=0;onlyErrors=false;selectedSheet='';overrides={};detailLinks={};outcome=null;
      dialog.innerHTML='<div class="bi-head"><h3>Leyendo el archivo…</h3><button type="button" class="icon-button" data-bi-close aria-label="Cerrar importación">×</button></div><div class="bi-body"><p data-bi-message role="status">La lectura se realiza en este navegador.</p></div>';if(!dialog.open)dialog.showModal();
      try{const book=await readFile(file);if(token!==revision)return;if(!matchingContext())throw Error('La empresa o la cuenta cambió durante la lectura. Cerrá esta revisión y volvé a seleccionar el archivo.');parsed=parseRows(book);render();}
      catch(error){if(token===revision)message(error.message||'No fue posible leer el archivo.',true);}
    }
    async function save(){
      if(busy||!parsed||outcome)return;if(!matchingContext()){message('La cuenta o la empresa cambió. Cerrá y volvé a abrir la importación para la empresa correcta.',true);return;}
      recompute();if(!snapshot.intakeAvailable||!analysis.payload.length||analysis.payload.length>MAX_CASES){message('Revisá la actualización y las filas antes de guardar.',true);return;}
      const rows=clone(analysis.payload),organizationId=snapshot.id,userId=snapshot.userId,selectedMode=mode,fileName=parsed.fileName,operationRevision=revision;
      busy=true;render();dialog.querySelectorAll('input,select,[data-bi-prev],[data-bi-next]').forEach(control=>{control.disabled=true;});
      try{
        const bytes=new TextEncoder().encode(JSON.stringify({fileName,mode:selectedMode,rows})),hash=await crypto.subtle.digest('SHA-256',bytes),key=[...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');
        if(!matchingContext()||context().userId!==userId)throw Error('La cuenta o la empresa cambió antes de guardar. Volvé a revisar el archivo.');
        const {data,error}=await client.rpc('import_case_workbook',{p_organization_id:organizationId,p_batch_key:key,p_file_name:fileName,p_rows:rows,p_mode:selectedMode});
        if(operationRevision!==revision)return;
        if(error){if(['PGRST202','42883','PGRST204'].includes(error.code))throw Error('Falta instalar sql/workbook_import.sql en Supabase. No se guardó la carga.');if(/capacidad|cupo/i.test(error.message||''))throw Error('La carga supera el cupo de esta empresa. No se guardaron casos.');if(error.code==='42501')throw Error('La sesión no tiene permiso para importar en esta empresa.');throw Error('No fue posible guardar la carga. Revisá los datos o intentá nuevamente; el lote evita duplicados.');}
        const conflicts=(data.rows||[]).filter(row=>row.status==='conflict');
        outcome=`Carga completada: ${data.inserted||0} nuevos, ${data.updated||0} completados, ${data.skipped||0} omitidos, ${conflicts.length} conflictos. ${analysis.reviewCount+conflicts.length} filas permanecen pendientes de revisión.`;
        for(const conflict of conflicts){const row=parsed.records.find(item=>item.key===conflict.key);if(row&&!row.errors.includes('Conflicto al guardar: revisá el nombre del caso existente'))row.errors.push('Conflicto al guardar: revisá el nombre del caso existente');}
        await onImported(data);toast('Importación completada.');
      }catch(error){if(operationRevision!==revision)return;outcome=null;busy=false;render();message(error.message||'No fue posible guardar la carga.',true);return;}
      busy=false;render();
    }
    dialog.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.hasAttribute('data-bi-close'))close();if(button.hasAttribute('data-bi-confirm'))save();if(button.hasAttribute('data-bi-prev')){page--;render();}if(button.hasAttribute('data-bi-next')){page++;render();}if(button.hasAttribute('data-bi-export')&&analysis){downloadCsv([['Hoja','Fila','Nombre','Cedula','Resultado','Observaciones'],...analysis.records.map(row=>[row.sheet,row.row,row.label,row.cedula||row.candidate||'',row.status,[...row.errors,...row.warnings].join(' | ')])],'bonoalerta-revision-importacion.csv');}});
    dialog.addEventListener('change',event=>{const target=event.target;if(busy||!parsed)return;if(target.hasAttribute('data-bi-mode'))mode=target.value;if(target.hasAttribute('data-bi-sheet')){selectedSheet=target.value;page=0;}if(target.hasAttribute('data-bi-details'))includeDetails=target.checked;if(target.hasAttribute('data-bi-enabled'))enabled=target.checked;if(target.hasAttribute('data-bi-errors')){onlyErrors=target.checked;page=0;}if(target.hasAttribute('data-bi-id'))overrides[target.dataset.biId]=target.value;if(target.hasAttribute('data-bi-link')){if(target.value)detailLinks[target.dataset.biLink]=target.value;else delete detailLinks[target.dataset.biLink];}render();});
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    function invalidate(){revision++;dialog.close();parsed=null;analysis=null;snapshot=null;outcome=null;busy=false;dialog.innerHTML='';}
    return{open,close,invalidate};
  }
  scope.BonoImport={readFile,parseRows,analyze,dateValue,csvMatrix,checkZip,mount,MAX_CASES};
})(globalThis);
