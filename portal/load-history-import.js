import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';

const normalize = value => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const clean = value => value === null || value === undefined || String(value).trim()==='' ? null : String(value).trim();
const numeric = value => {
  if (value === null || value === undefined || String(value).trim()==='') return null;
  const n=Number(String(value).replace(/[$,]/g,'').replace(/%/g,''));
  return Number.isFinite(n) && n>=0 ? n : null;
};
const dateOnly = (value, XLSXLib) => {
  if(value===null || value===undefined || value==='') return null;
  if(value instanceof Date && !Number.isNaN(value.getTime())) return [value.getFullYear(),String(value.getMonth()+1).padStart(2,'0'),String(value.getDate()).padStart(2,'0')].join('-');
  if(typeof value==='number'){
    const p=XLSXLib.SSF.parse_date_code(value);
    if(p?.y&&p?.m&&p?.d)return [p.y,String(p.m).padStart(2,'0'),String(p.d).padStart(2,'0')].join('-');
  }
  const s=String(value).trim();
  const m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if(m){let y=Number(m[3]);if(y<100)y+=y<50?2000:1900;return [y,String(Number(m[1])).padStart(2,'0'),String(Number(m[2])).padStart(2,'0')].join('-')}
  const iso=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(iso)return [iso[1],String(Number(iso[2])).padStart(2,'0'),String(Number(iso[3])).padStart(2,'0')].join('-');
  return null;
};
const statusValue = value => {
  const s=normalize(value);
  if(!s)return 'booked';
  if(['cancelled','canceled'].includes(s))return 'canceled';
  if(['delivered','complete','completed'].includes(s))return 'delivered';
  if(['in transit','transit','loaded','dispatched','at pickup','at delivery'].includes(s))return 'in_transit';
  if(['pending','awaiting ratecon','awaiting confirmation','draft'].includes(s))return 'pending';
  if(['booked','book'].includes(s))return 'booked';
  if(s==='accessorial')return 'delivered';
  return 'pending';
};
const makeKey = row => [row.po_number,row.pickup_date,row.pickup_city,row.pickup_state,row.delivery_city,row.delivery_state,row.broker_name]
  .map(v=>normalize(v)).join('|');

function findColumn(headers, names, occurrence=0) {
  const wanted=names.map(normalize);
  const matches=[];
  headers.forEach((h,i)=>{if(wanted.includes(normalize(h)))matches.push(i)});
  return matches[occurrence] ?? -1;
}

function mapRows(matrix) {
  const headerIndex=Math.max(0,matrix.findIndex(row=>{
    const names=(row||[]).map(normalize);
    return names.includes('po') && names.some(x=>x==='broker'||x==='brokerage') && names.filter(x=>x==='date'||x==='pickup date'||x==='delivery date').length>=1;
  }));
  const headers=(matrix[headerIndex]||[]).map(x=>String(x??'').trim());
  const col={
    po:findColumn(headers,['po','po #','po number','po no']),
    pickupDate:findColumn(headers,['date','pickup date','pick up date'],0),
    pickupCity:findColumn(headers,['city','pickup city','pick up city'],0),
    pickupState:findColumn(headers,['pu st','pickup state','pick up state','origin state']),
    pickupTime:findColumn(headers,['time','pickup time','pick up time'],0),
    deliveryDate:findColumn(headers,['delivery date','del date','date'],1),
    deliveryCity:findColumn(headers,['delivery city','del city','city'],1),
    deliveryState:findColumn(headers,['del st','delivery state','destination state']),
    deliveryTime:findColumn(headers,['delivery time','del time','time'],1),
    miles:findColumn(headers,['miles','loaded miles']),
    deadhead:findColumn(headers,['d h','dh','deadhead','deadhead miles']),
    broker:findColumn(headers,['broker','brokerage']),
    weight:findColumn(headers,['weight','weight lbs']),
    pay:findColumn(headers,['pay','carrier pay','gross pay','load pay']),
    rpm:findColumn(headers,['rpm','rate per mile']),
    market:findColumn(headers,['market','market rpm']),
    notes:findColumn(headers,['notes','load notes']),
    status:findColumn(headers,['status','load status'])
  };
  const missing=['po','pickupDate','pickupCity','pickupState','deliveryDate','deliveryCity','deliveryState','pay'].filter(k=>col[k]<0);
  if(missing.length)throw new Error('Could not identify required columns: '+missing.join(', ')+'. Check that the first row contains the column headings.');
  const rows=[];
  matrix.slice(headerIndex+1).forEach((cells,index)=>{
    const value=k=>col[k]>=0?cells[col[k]]:null;
    if(cells.every(v=>String(v??'').trim()===''))return;
    const row={
      source_row:index+2,
      po_number:clean(value('po')),
      pickup_date:dateOnly(value('pickupDate'),XLSX),
      pickup_city:clean(value('pickupCity')),
      pickup_state:clean(value('pickupState'))?.toUpperCase(),
      pickup_time:clean(value('pickupTime')),
      delivery_date:dateOnly(value('deliveryDate'),XLSX),
      delivery_city:clean(value('deliveryCity')),
      delivery_state:clean(value('deliveryState'))?.toUpperCase(),
      delivery_time:clean(value('deliveryTime')),
      miles:numeric(value('miles')),
      deadhead_miles:numeric(value('deadhead')),
      broker_name:clean(value('broker')),
      weight_lbs:numeric(value('weight')),
      carrier_pay:numeric(value('pay')),
      source_rpm:numeric(value('rpm')),
      market_rpm:numeric(value('market')),
      load_notes:clean(value('notes')),
      status:statusValue(value('status'))
    };
    row.source_import_key=makeKey(row);
    row.errors=[];
    if(!row.po_number)row.errors.push('Missing PO number');
    if(!row.pickup_date)row.errors.push('Missing or unrecognized pickup date');
    if(!row.delivery_date)row.errors.push('Missing or unrecognized delivery date');
    if(!row.pickup_city||!row.pickup_state)row.errors.push('Missing pickup city/state');
    if(!row.delivery_city||!row.delivery_state)row.errors.push('Missing delivery city/state');
    if(row.carrier_pay===null)row.errors.push('Missing or invalid gross carrier pay');
    row.base_errors=[...row.errors];
    rows.push(row);
  });
  return rows;
}

export async function initLoadHistoryImport({supabase,user,carriers,root,onNotice,onImported}) {
  if(!root||!user||!carriers?.length)return;
  const section=document.createElement('section');
  section.className='load-history-import card';
  section.hidden=true;
  const heading=document.createElement('div');heading.className='load-history-import-heading';
  const title=document.createElement('div');
  const h=document.createElement('h3');h.textContent='Import historical load history';
  const p=document.createElement('p');p.textContent='Upload an Excel or CSV load board. This imports basic shipment details only; it does not read PDFs or use AI.';
  title.append(h,p);
  const close=document.createElement('button');close.type='button';close.className='button';close.textContent='Close';close.addEventListener('click',()=>{section.hidden=true});
  heading.append(title,close);
  const carrierLabel=document.createElement('label');carrierLabel.className='load-field';const carrierCaption=document.createElement('span');carrierCaption.textContent='Carrier account';const carrier=document.createElement('select');carrier.append(new Option('Select carrier',''));carriers.forEach(c=>carrier.append(new Option((c.business_name||c.company_name||'Carrier')+' · MC '+(c.mc_number||'—'),c.user_id)));carrierLabel.append(carrierCaption,carrier);
  const fileLabel=document.createElement('label');fileLabel.className='load-field';const fileCaption=document.createElement('span');fileCaption.textContent='Excel or CSV file';const file=document.createElement('input');file.type='file';file.accept='.xlsx,.xls,.csv';fileLabel.append(fileCaption,file);
  const controls=document.createElement('div');controls.className='load-history-import-controls';controls.append(carrierLabel,fileLabel);
  const help=document.createElement('p');help.className='load-form-help';help.textContent='Expected columns include PO, pickup date/city/state/time, delivery date/city/state/time, miles, deadhead, broker, weight, pay, RPM, market, notes, and status. Repeated Date, City, and Time headings are handled in left-to-right order.';
  const preview=document.createElement('div');preview.className='load-history-import-preview';preview.hidden=true;
  const actions=document.createElement('div');actions.className='load-form-actions';
  const importButton=document.createElement('button');importButton.type='button';importButton.className='button primary';importButton.textContent='Import valid loads';importButton.disabled=true;
  const cancelButton=document.createElement('button');cancelButton.type='button';cancelButton.className='button';cancelButton.textContent='Clear preview';cancelButton.addEventListener('click',()=>{preview.replaceChildren();preview.hidden=true;importButton.disabled=true;file.value='';parsedRows=[]});
  actions.append(importButton,cancelButton);
  section.append(heading,controls,help,preview,actions);
  root.append(section);
  let parsedRows=[];
  const notice=(message,isError=false)=>onNotice?.(message,isError);
  const renderPreview=async rows=>{
    rows.forEach(r=>{r.errors=[...(r.base_errors||r.errors||[])]});
    const keys=new Set();let duplicateInFile=0;
    rows.forEach(r=>{if(keys.has(r.source_import_key)){r.errors.push('Duplicate row in this file');duplicateInFile++}else keys.add(r.source_import_key)});
    const carrierId=carrier.value;
    let existing=new Set();
    if(carrierId){
      const {data,error}=await supabase.from('dispatch_loads').select('source_import_key').eq('carrier_user_id',carrierId).not('source_import_key','is',null);
      if(error)throw error;
      existing=new Set((data||[]).map(x=>x.source_import_key));
    }
    rows.forEach(r=>{if(existing.has(r.source_import_key))r.errors.push('Already imported for this carrier')});
    const ready=rows.filter(r=>!r.errors.length);
    preview.replaceChildren();
    const summary=document.createElement('div');summary.className='load-history-import-summary';
    summary.textContent=rows.length+' rows found · '+ready.length+' ready · '+(rows.length-ready.length)+' skipped / flagged'+(duplicateInFile?' · '+duplicateInFile+' duplicate rows':'');
    preview.append(summary);
    const table=document.createElement('table');table.className='load-history-preview-table';
    const thead=document.createElement('thead'),tr=document.createElement('tr');
    ['PO','Pickup','Delivery','Broker','Gross pay','Status','Import check'].forEach(label=>{const th=document.createElement('th');th.textContent=label;tr.append(th)});thead.append(tr);table.append(thead);
    const tbody=document.createElement('tbody');
    rows.slice(0,30).forEach(r=>{const tr=document.createElement('tr');const vals=[r.po_number,[r.pickup_date,r.pickup_city,r.pickup_state,r.pickup_time].filter(Boolean).join(' · '),[r.delivery_date,r.delivery_city,r.delivery_state,r.delivery_time].filter(Boolean).join(' · '),r.broker_name,r.carrier_pay===null?'':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(r.carrier_pay),r.status,r.errors.join('; ')||'Ready'];vals.forEach(v=>{const td=document.createElement('td');td.textContent=String(v??'');tr.append(td)});tbody.append(tr)});
    table.append(tbody);preview.append(table);
    if(rows.length>30){const more=document.createElement('p');more.textContent='Showing first 30 rows in preview; all '+rows.length+' rows are included in the import summary.';preview.append(more)}
    importButton.textContent='Import '+ready.length+' valid loads';importButton.disabled=!ready.length;
    parsedRows=rows;
  };
  file.addEventListener('change',async()=>{
    preview.hidden=true;importButton.disabled=true;parsedRows=[];
    if(!file.files?.[0])return;
    if(!carrier.value){notice('Select the carrier account before choosing a file.',true);file.value='';return}
    try{
      const workbook=XLSX.read(await file.files[0].arrayBuffer(),{type:'array',cellDates:true});
      const sheet=workbook.Sheets[workbook.SheetNames[0]];
      const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:''});
      if(!matrix.length)throw new Error('The selected file is empty.');
      await renderPreview(mapRows(matrix));
      preview.hidden=false;
    }catch(e){notice('Could not read this load history file: '+(e.message||e),true)}
  });
  carrier.addEventListener('change',async()=>{if(parsedRows.length){try{await renderPreview(parsedRows)}catch(e){notice(e.message,true)}}});
  importButton.addEventListener('click',async()=>{
    const carrierId=carrier.value;
    if(!carrierId||!parsedRows.length)return;
    const rows=parsedRows.filter(r=>!r.errors.length);
    importButton.disabled=true;importButton.textContent='Importing…';
    let imported=0,failed=0;
    for(const row of rows){
      let loadId=null;
      try{
        const {data:load,error}=await supabase.from('dispatch_loads').insert({
          carrier_user_id:carrierId,created_by:user.id,status:row.status,
          po_number:row.po_number,broker_name:row.broker_name,weight_lbs:row.weight_lbs,
          miles:row.miles,deadhead_miles:row.deadhead_miles,load_notes:row.load_notes,
          source_import_key:row.source_import_key
        }).select('id').single();
        if(error)throw error;loadId=load.id;
        const stops=[
          {load_id:loadId,stop_order:1,stop_type:'pickup',city:row.pickup_city,state:row.pickup_state,appointment_date:row.pickup_date,appointment_label:row.pickup_time,appointment_type:/fcfs/i.test(row.pickup_time||'')?'fcfs':'appointment'},
          {load_id:loadId,stop_order:2,stop_type:'delivery',city:row.delivery_city,state:row.delivery_state,appointment_date:row.delivery_date,appointment_label:row.delivery_time,appointment_type:/fcfs/i.test(row.delivery_time||'')?'fcfs':'appointment'}
        ];
        const {error:stopError}=await supabase.from('dispatch_load_stops').insert(stops);if(stopError)throw stopError;
        const {error:financialError}=await supabase.from('dispatch_load_financials').insert({load_id:loadId,carrier_pay:row.carrier_pay,source_rpm:row.source_rpm,market_rpm:row.market_rpm,updated_by:user.id});
        if(financialError)throw financialError;
        imported++;
      }catch(e){
        failed++;
        if(loadId)await supabase.from('dispatch_loads').delete().eq('id',loadId);
        notice('A row could not be imported (PO '+(row.po_number||'unknown')+'): '+(e.message||e),true);
      }
    }
    notice('Historical import finished: '+imported+' loads imported, '+failed+' failed. Re-importing this same file will skip already imported rows.');
    file.value='';preview.hidden=true;preview.replaceChildren();parsedRows=[];
    await onImported?.();
    importButton.disabled=true;importButton.textContent='Import valid loads';
  });
  return section;
}
