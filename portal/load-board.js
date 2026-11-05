export async function initLoadBoard({supabase,user,role,root,carrierUserId=null}) {
  if (!supabase || !user || !role || !root) return;
  const canManage = role === 'platform_owner' || role === 'dispatcher' || role === 'dispatcher_admin';
  const isDriver = role === 'driver';
  const fixedCarrierId = carrierUserId || (role === 'carrier' || role === 'carrier_admin' ? user.id : null);
  const $ = (tag, cls, value) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (value !== undefined && value !== null) n.textContent = String(value);
    return n;
  };
  const button = (label, cls, fn) => {
    const b = $('button', cls || 'button', label); b.type = 'button'; b.addEventListener('click', fn); return b;
  };
  const safe = v => v === null || v === undefined || v === '' ? '—' : String(v);
  const money = v => v === null || v === undefined ? '—' : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v));
  const fmtDate = v => v ? new Date(v).toLocaleString() : 'Not entered';
  const statusText = s => (s || 'booked').replaceAll('_',' ');
  const notice = $('div','load-board-notice'); notice.hidden = true;
  const say = (msg,error=false) => { notice.textContent=msg; notice.className='load-board-notice'+(error?' error':''); notice.hidden=false; };
  const header = $('div','load-board-header');
  const intro = $('div'); intro.append($('h2','',isDriver?'My Assigned Loads':'Load Board'),$('p','',isDriver?'Loads assigned to you. Broker pay and dispatch financials are not shown.':fixedCarrierId?'Loads assigned to this carrier.':'Manage loads across your authorized carriers.'));
  header.append(intro);
  const tools = $('div','load-board-tools');
  const search = $('input','load-board-search'); search.type='search'; search.placeholder='Search PO, broker, city, or load number';
  const filter = $('select','load-board-filter'); [['','All statuses'],['draft','Draft'],['booked','Booked'],['dispatched','Dispatched'],['at_pickup','At pickup'],['loaded','Loaded'],['in_transit','In transit'],['at_delivery','At delivery'],['delivered','Delivered'],['on_hold','On hold'],['canceled','Canceled']].forEach(([v,t])=>filter.append(new Option(t,v)));
  tools.append(search,filter);
  if(canManage) header.append(button('Build Load +','button primary',()=>{formCard.hidden=!formCard.hidden; if(!formCard.hidden)formCard.scrollIntoView({behavior:'smooth',block:'start'});}));
  root.replaceChildren(header,notice,tools);
  const formCard = $('section','load-board-form card'); formCard.hidden=true;
  const list = $('div','load-board-list');
  root.append(formCard,list);

  const carriers = fixedCarrierId ? [] : (canManage ? await loadCarriers() : []);
  async function loadCarriers(){
    const q=supabase.from('carrier_profiles').select('user_id,business_name,company_name,mc_number').order('business_name');
    const {data,error}=await q;
    if(error)throw error;
    return data||[];
  }
  let carrierChoices = carriers;
  const carrierName = id => carrierChoices.find(c=>c.user_id===id)?.business_name || carrierChoices.find(c=>c.user_id===id)?.company_name || 'Carrier';
  const selectedCarrier = fixedCarrierId;
  if(selectedCarrier){
    const {data,error}=await supabase.from('carrier_profiles').select('user_id,business_name,company_name,mc_number').eq('user_id',selectedCarrier).maybeSingle();
    if(error) say(error.message,true);
    carrierChoices=data?[data]:[];
  }

  const carrierSelect = $('select',''); carrierSelect.append(new Option('Select carrier',''));
  carrierChoices.forEach(c=>carrierSelect.append(new Option((c.business_name||c.company_name||'Carrier')+' · MC '+(c.mc_number||'—'),c.user_id)));
  if(fixedCarrierId){carrierSelect.value=fixedCarrierId;carrierSelect.disabled=true;}

  const makeField=(label,name,type='text',placeholder='')=>{
    const wrap=$('label','load-field');wrap.append($('span','',label));
    const input= type==='select' ? $('select') : $('input');
    if(type!=='select')input.type=type;
    if(placeholder)input.placeholder=placeholder;
    input.name=name;wrap.append(input);return {wrap,input};
  };
  const fieldGrid=$('div','load-form-grid');
  const defs=[
    ['PO number','po_number'],['Broker load number','broker_load_number'],['Pickup number','pickup_number'],['BOL number','bol_number'],
    ['Broker / brokerage','broker_name'],['Broker contact','broker_contact_name'],['Broker phone','broker_phone','tel'],['Broker email','broker_email','email'],
    ['Commodity','commodity'],['Weight (lbs)','weight_lbs','number'],['Loaded miles','miles','number'],['Deadhead miles','deadhead_miles','number']
  ];
  const inputs={};
  for(const [label,name,type='text'] of defs){const f=makeField(label,name,type);if(type==='number'){f.input.min='0';f.input.step='0.01'}inputs[name]=f.input;fieldGrid.append(f.wrap)}
  const carrierWrap=$('label','load-field');carrierWrap.append($('span','','Carrier'));carrierWrap.append(carrierSelect);fieldGrid.prepend(carrierWrap);
  const driverWrap=$('label','load-field');driverWrap.append($('span','','Driver'));const driverSelect=$('select');driverSelect.append(new Option('Select driver',''));driverWrap.append(driverSelect);fieldGrid.append(driverWrap);
  const truckWrap=$('label','load-field');truckWrap.append($('span','','Saved truck profile'));const truckSelect=$('select');truckSelect.append(new Option('Select truck profile',''));truckWrap.append(truckSelect);fieldGrid.append(truckWrap);
  const stopHeading=$('div','load-form-section-title','Pickup and delivery');
  const stopGrid=$('div','load-stop-grid');
  const stopDefs=[['Pickup','pickup'],['Delivery','delivery']];
  const stopInputs={};
  for(const [label,prefix] of stopDefs){
    const card=$('div','load-stop-card');card.append($('h3','',label));
    const fds=[['Facility','facility_name'],['Address','address_line_1'],['City','city'],['State','state'],['ZIP','postal_code'],['Date and time','appointment_start','datetime-local'],['Hours / window','facility_hours']];
    stopInputs[prefix]={};
    for(const [caption,key,type='text'] of fds){
      const f=makeField(caption,prefix+'_'+key,type);stopInputs[prefix][key]=f.input;card.append(f.wrap);
    }
    const ap=makeField('Appointment type',prefix+'_appointment_type','select');
    ap.input.append(new Option('Appointment','appointment'),new Option('FCFS','fcfs'));
    stopInputs[prefix].appointment_type=ap.input;card.append(ap.wrap);
    const contact=makeField('Facility contact name',prefix+'_contact_name');
    const phone=makeField('Facility phone',prefix+'_contact_phone','tel');
    const email=makeField('Facility email',prefix+'_contact_email','email');
    const notes=makeField('Instructions / notes',prefix+'_instructions');
    for(const f of [contact,phone,email,notes]){stopInputs[prefix][f.input.name.replace(prefix+'_','')]=f.input;card.append(f.wrap)}
    stopGrid.append(card);
  }
  const financialHeading=$('div','load-form-section-title','Dispatcher financials');
  const financialGrid=$('div','load-form-grid');
  const pay=makeField('Carrier pay ($)','carrier_pay','number');pay.input.min='0';pay.input.step='0.01';
  const market=makeField('Market RPM','market_rpm','number');market.input.min='0';market.input.step='0.0001';
  const source=makeField('Market RPM source','market_rpm_source');
  const internal=makeField('Internal dispatch notes','internal_notes');inputs.internal_notes=internal.input;
  [pay,market,source,internal].forEach(f=>financialGrid.append(f.wrap));
  const actions=$('div','load-form-actions');
  const save=button('Save and publish load','button primary',()=>submitLoad());
  const cancel=button('Cancel','button',()=>{formCard.hidden=true});
  actions.append(save,cancel);
  formCard.append($('h3','','Build a load'),$('p','load-form-help','Enter the load information, assign the carrier and driver, and verify both stops before publishing. Rate-confirmation AI upload is a later phase.'),fieldGrid,stopHeading,stopGrid,financialHeading,financialGrid,actions);

  async function loadCarrierResources(id){
    driverSelect.replaceChildren(new Option('Select driver',''));
    truckSelect.replaceChildren(new Option('Select truck profile',''));
    if(!id)return;
    const [drivers,driverAccounts,trucks]=await Promise.all([
      supabase.from('carrier_drivers').select('id,display_name,driver_status').eq('carrier_user_id',id).eq('driver_status','active').order('display_name'),
      supabase.from('driver_profiles').select('user_id,full_name').eq('carrier_user_id',id).order('full_name'),
      supabase.from('carrier_truck_profiles').select('id,profile_name,profile_status').eq('carrier_user_id',id).eq('profile_status','active').order('profile_name')
    ]);
    if(drivers.error)throw drivers.error;if(driverAccounts.error)throw driverAccounts.error;if(trucks.error)throw trucks.error;
    (driverAccounts.data||[]).forEach(d=>driverSelect.append(new Option((d.full_name||'Driver')+' · Portal login','profile:'+d.user_id)));
    (drivers.data||[]).forEach(d=>driverSelect.append(new Option((d.display_name||'Driver')+' · Employee profile','record:'+d.id)));
    (trucks.data||[]).forEach(t=>truckSelect.append(new Option(t.profile_name,t.id)));
  }
  if(canManage && carrierSelect.value) await loadCarrierResources(carrierSelect.value).catch(e=>say(e.message,true));
  carrierSelect.addEventListener('change',()=>loadCarrierResources(carrierSelect.value).catch(e=>say(e.message,true)));

  async function submitLoad(){
    const carrierId=carrierSelect.value;
    if(!carrierId)return say('Select a carrier before creating a load.',true);
    const pickupCity=stopInputs.pickup.city.value.trim(), pickupState=stopInputs.pickup.state.value.trim();
    const deliveryCity=stopInputs.delivery.city.value.trim(), deliveryState=stopInputs.delivery.state.value.trim();
    if(!pickupCity||!pickupState||!deliveryCity||!deliveryState)return say('Enter pickup and delivery cities and states.',true);
    save.disabled=true;save.textContent='Saving…';
    let loadId=null;
    try{
      const driverChoice=driverSelect.value||'';
      const payload={carrier_user_id:carrierId,
        driver_id:driverChoice.startsWith('record:')?driverChoice.slice(7):null,
        driver_user_id:driverChoice.startsWith('profile:')?driverChoice.slice(8):null,
        truck_profile_id:truckSelect.value||null,
        created_by:user.id,status:'draft',internal_notes:inputs.internal_notes.value.trim()||null};
      for(const key of ['po_number','broker_load_number','pickup_number','bol_number','broker_name','broker_contact_name','broker_phone','broker_email','commodity'])payload[key]=inputs[key].value.trim()||null;
      for(const key of ['weight_lbs','miles','deadhead_miles'])payload[key]=inputs[key].value?Number(inputs[key].value):null;
      const {data:load,error}=await supabase.from('dispatch_loads').insert(payload).select('id').single();
      if(error)throw error;loadId=load.id;
      const stops=[];
      for(const [index,prefix] of ['pickup','delivery'].entries()){
        const v=stopInputs[prefix];
        stops.push({load_id:loadId,stop_order:index+1,stop_type:prefix,facility_name:v.facility_name.value.trim()||null,
          address_line_1:v.address_line_1.value.trim()||null,city:v.city.value.trim(),state:v.state.value.trim(),postal_code:v.postal_code.value.trim()||null,
          appointment_type:v.appointment_type.value,appointment_start:v.appointment_start.value?new Date(v.appointment_start.value).toISOString():null,
          facility_hours:v.facility_hours.value.trim()||null,contact_name:v.contact_name.value.trim()||null,
          contact_phone:v.contact_phone.value.trim()||null,contact_email:v.contact_email.value.trim()||null,instructions:v.instructions.value.trim()||null});
      }
      const {error:stopError}=await supabase.from('dispatch_load_stops').insert(stops);if(stopError)throw stopError;
      const financial={load_id:loadId,carrier_pay:pay.input.value?Number(pay.input.value):null,
        market_rpm:market.input.value?Number(market.input.value):null,market_rpm_source:source.input.value.trim()||null,
        updated_by:user.id,updated_at:new Date().toISOString()};
      const {error:finError}=await supabase.from('dispatch_load_financials').insert(financial);if(finError)throw finError;
      const {error:publishError}=await supabase.from('dispatch_loads').update({status:'booked'}).eq('id',loadId);if(publishError)throw publishError;
      Object.values(inputs).forEach(input=>input.value='');Object.values(stopInputs).forEach(group=>Object.values(group).forEach(input=>input.value=''));pay.input.value='';market.input.value='';source.input.value='';if(fixedCarrierId)carrierSelect.value=fixedCarrierId;driverSelect.value='';truckSelect.value='';formCard.hidden=true;
      say('Load created and published.');await refresh();
    }catch(e){
      say((loadId?'Load saved as a draft, but the remaining setup did not finish: ':'Could not create load: ')+(e.message||e),true);
    }finally{save.disabled=false;save.textContent='Save and publish load'}
  }
  // Form fields are independent controls; prevent accidental page submission from browser Enter key.
  fieldGrid.addEventListener('keydown',e=>{if(e.key==='Enter' && e.target.tagName!=='TEXTAREA')e.preventDefault()});

  async function refresh(){
    list.replaceChildren($('div','load-board-loading','Loading loads…'));
    let query=supabase.from('dispatch_loads').select('*').order('created_at',{ascending:false});
    if(fixedCarrierId)query=query.eq('carrier_user_id',fixedCarrierId);
    const {data:loads,error}=await query;
    if(error){list.replaceChildren($('div','load-board-empty',error.message));return}
    const ids=(loads||[]).map(x=>x.id);
    let financials=[],stops=[],documents=[];
    const driverNames=new Map(),driverAccountNames=new Map();
    if(!isDriver && loads?.length){const carrierIds=[...new Set(loads.map(x=>x.carrier_user_id))];const [driverRows,accountRows]=await Promise.all([
      supabase.from('carrier_drivers').select('id,display_name').in('carrier_user_id',carrierIds),
      supabase.from('driver_profiles').select('user_id,full_name').in('carrier_user_id',carrierIds)
    ]);if(driverRows.error)say(driverRows.error.message,true);if(accountRows.error)say(accountRows.error.message,true);(driverRows.data||[]).forEach(x=>driverNames.set(x.id,x.display_name));(accountRows.data||[]).forEach(x=>driverAccountNames.set(x.user_id,x.full_name))}
    if(ids.length){
      const [f,s,d]=await Promise.all([
        isDriver?Promise.resolve({data:[]}):supabase.from('dispatch_load_financials').select('*').in('load_id',ids),
        supabase.from('dispatch_load_stops').select('*').in('load_id',ids).order('stop_order'),
        supabase.from('dispatch_load_documents').select('*').in('load_id',ids).order('uploaded_at',{ascending:false})
      ]);
      if(f.error) say(f.error.message,true);if(s.error)say(s.error.message,true);if(d.error)say(d.error.message,true);
      financials=f.data||[];stops=s.data||[];documents=d.data||[];
    }
    const finById=new Map(financials.map(x=>[x.load_id,x]));
    const stopById=new Map();stops.forEach(s=>{if(!stopById.has(s.load_id))stopById.set(s.load_id,[]);stopById.get(s.load_id).push(s)});
    const docById=new Map();documents.forEach(d=>{if(!docById.has(d.load_id))docById.set(d.load_id,[]);docById.get(d.load_id).push(d)});
    const term=search.value.trim().toLowerCase(),state=filter.value;
    const shown=(loads||[]).filter(l=>{
      if(state&&l.status!==state)return false;
      const ss=stopById.get(l.id)||[];
      const hay=[l.po_number,l.broker_load_number,l.broker_name,...ss.flatMap(s=>[s.city,s.state,s.facility_name])].filter(Boolean).join(' ').toLowerCase();
      return !term||hay.includes(term);
    });
    list.replaceChildren();
    if(!shown.length){list.append($('div','load-board-empty','No loads match this view yet. Use Build Load to create the first record.'));return}
    for(const load of shown){
      const ss=stopById.get(load.id)||[],p=ss.find(x=>x.stop_type==='pickup'),d=ss.find(x=>x.stop_type==='delivery'),fin=finById.get(load.id);
      const card=$('article','load-board-card');
      const top=$('div','load-card-top');
      const name=$('div');name.append($('strong','',load.po_number||load.broker_load_number||'Load '+load.id.slice(0,8)),$('span','',safe(load.broker_name)));
      const badge=$('span','load-status load-status-'+load.status,statusText(load.status));
      top.append(name,badge);
      const route=$('div','load-route');
      const from=$('div');from.append($('small','','PICKUP'),$('strong','',[p?.city,p?.state].filter(Boolean).join(', ')||'Not entered'),$('span','',fmtDate(p?.appointment_start)));
      const arrow=$('span','load-route-arrow','→');
      const to=$('div');to.append($('small','','DELIVERY'),$('strong','',[d?.city,d?.state].filter(Boolean).join(', ')||'Not entered'),$('span','',fmtDate(d?.appointment_start)));
      route.append(from,arrow,to);
      const meta=$('div','load-card-meta');
      const metaValues=[['Carrier',carrierName(load.carrier_user_id)],['Driver',isDriver?'You':(driverAccountNames.get(load.driver_user_id)||driverNames.get(load.driver_id)||'Unassigned')],['Miles',safe(load.miles)],['Deadhead',safe(load.deadhead_miles)],['Weight',load.weight_lbs?Number(load.weight_lbs).toLocaleString()+' lb':'—']];
      if(!fixedCarrierId && canManage)metaValues[0][1]=carrierName(load.carrier_user_id);
      metaValues.forEach(([k,v])=>{const x=$('div');x.append($('small','',k),$('strong','',v));meta.append(x)});
      if(!isDriver && fin){const x=$('div');x.append($('small','','Carrier pay'),$('strong','',money(fin.carrier_pay)));meta.append(x);const rpm=$('div');rpm.append($('small','','Carrier RPM'),$('strong','',load.miles>0&&fin.carrier_pay!=null?'$'+(Number(fin.carrier_pay)/Number(load.miles)).toFixed(2):'—'));meta.append(rpm)}
      const actions=$('div','load-card-actions');
      const detail=button('View details','button',()=>detailPanel.hidden=!detailPanel.hidden);
      const detailPanel=$('div','load-detail-panel');detailPanel.hidden=true;
      detailPanel.append($('h3','','Load details'));
      const info=$('div','load-detail-grid');
      const pairs=[['PO number',load.po_number],['Broker load #',load.broker_load_number],['Pickup #',load.pickup_number],['BOL #',load.bol_number],['Broker',load.broker_name],['Broker contact',load.broker_contact_name],['Broker phone',load.broker_phone],['Broker email',load.broker_email],['Commodity',load.commodity],['Weight',load.weight_lbs],['Loaded miles',load.miles],['Deadhead',load.deadhead_miles],['Status',statusText(load.status)],['Assigned driver',isDriver?'You':(driverAccountNames.get(load.driver_user_id)||driverNames.get(load.driver_id)||'Unassigned')]];
      const pairs=[['PO number',load.po_number],['Broker load #',load.broker_load_number],['Pickup #',load.pickup_number],['BOL #',load.bol_number],['Broker',load.broker_name],['Broker contact',load.broker_contact_name],['Broker phone',load.broker_phone],['Broker email',load.broker_email],['Commodity',load.commodity],['Weight',load.weight_lbs],['Loaded miles',load.miles],['Deadhead',load.deadhead_miles],['Status',statusText(load.status)],['Assigned driver',isDriver?'You':(driverAccountNames.get(load.driver_user_id)||driverNames.get(load.driver_id)||'Unassigned')]];
      if(!isDriver&&fin)pairs.push(['Carrier pay',money(fin.carrier_pay)],['Carrier RPM',load.miles>0&&fin.carrier_pay!=null?'$'+(Number(fin.carrier_pay)/Number(load.miles)).toFixed(2):'—'],['Market RPM',fin.market_rpm??'—'],['Market RPM source',fin.market_rpm_source??'Not provided']);
      detailPanel.append(info);
      if(canManage){const statusRow=$('div','load-status-editor');const statusSelect=$('select');[['draft','Draft'],['booked','Booked'],['dispatched','Dispatched'],['at_pickup','At pickup'],['loaded','Loaded'],['in_transit','In transit'],['at_delivery','At delivery'],['delivered','Delivered'],['on_hold','On hold'],['canceled','Canceled']].forEach(([v,t])=>statusSelect.append(new Option(t,v)));statusSelect.value=load.status;const updateStatus=button('Update status','button',async()=>{updateStatus.disabled=true;const {error}=await supabase.from('dispatch_loads').update({status:statusSelect.value}).eq('id',load.id);updateStatus.disabled=false;if(error)say(error.message,true);else{say('Load status updated.');await refresh()}});statusRow.append($('span','','Status'),statusSelect,updateStatus);detailPanel.append(statusRow)}
      for(const st of ss){
        const box=$('div','load-detail-stop');box.append($('h4','',st.stop_type.toUpperCase()+' · '+(st.facility_name||'Facility')));
        const address=[st.address_line_1,st.address_line_2,st.city,st.state,st.postal_code].filter(Boolean).join(', ');
        box.append($('p','',address||'Address not entered'));
        if(address){const links=$('div','load-inline-links');const copy=button('Copy address','button',()=>{if(!navigator.clipboard)return say('Clipboard access is unavailable in this browser.',true);navigator.clipboard.writeText(address).then(()=>say('Address copied.')).catch(()=>say('Could not copy address.',true))});const map=$('a','button','Open map');map.href='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(address);map.target='_blank';map.rel='noopener';links.append(copy,map);box.append(links)}
        box.append($('p','',st.appointment_type==='fcfs'?'FCFS':fmtDate(st.appointment_start)),$('p','',st.facility_hours||''),$('p','',st.instructions||''));
        if(st.contact_phone){const a=$('a','','Call facility');a.href='tel:'+st.contact_phone;box.append(a)}
        if(st.contact_email){const a=$('a','','Email facility');a.href='mailto:'+st.contact_email;box.append(a)}
        detailPanel.append(box);
      }
      const docs=docById.get(load.id)||[];
      if(docs.length){const docBox=$('div','load-detail-docs');docBox.append($('h4','','Documents'));for(const doc of docs){const row=$('div','load-document-row');row.append($('span','',doc.file_name+' · '+doc.document_type.replaceAll('_',' ')));const open=button('Open','button',async()=>{const {data,error}=await supabase.storage.from('load-documents').createSignedUrl(doc.file_path,300);if(error)say(error.message,true);else window.open(data.signedUrl,'_blank','noopener')});row.append(open);docBox.append(row)}detailPanel.append(docBox)}
      if(canManage){
        const upload=$('form','load-document-upload');const type=$('select');[['rate_confirmation','Rate confirmation'],['info_sheet','Info sheet'],['bol','BOL'],['receipt','Receipt'],['other','Other']].forEach(([v,t])=>type.append(new Option(t,v)));
        const file=$('input');file.type='file';file.accept='.pdf,.jpg,.jpeg,.png';file.required=true;
        upload.append(type,file);const upBtn=$('button','button','Upload document');upBtn.type='submit';upload.append(upBtn);
        upload.addEventListener('submit',async e=>{e.preventDefault();if(!file.files[0])return;upBtn.disabled=true;try{const f=file.files[0];if(!['application/pdf','image/jpeg','image/png'].includes(f.type)||f.size>52428800)throw new Error('Use a PDF, JPG, or PNG under 50 MB.');const path=load.id+'/'+crypto.randomUUID()+'-'+f.name.replace(/[^a-zA-Z0-9._-]+/g,'-');const {error:u}=await supabase.storage.from('load-documents').upload(path,f,{contentType:f.type,upsert:false});if(u)throw u;const {error:ins}=await supabase.from('dispatch_load_documents').insert({load_id:load.id,document_type:type.value,file_name:f.name,file_path:path,content_type:f.type,uploaded_by:user.id});if(ins){await supabase.storage.from('load-documents').remove([path]);throw ins}say('Document uploaded.');await refresh()}catch(e){say(e.message,true)}finally{upBtn.disabled=false}});
        detailPanel.append(upload);
      }
      actions.append(detail);card.append(top,route,meta,actions,detailPanel);list.append(card);
    }
  }
  search.addEventListener('input',()=>refresh());filter.addEventListener('change',()=>refresh());
  await refresh();
}
