export async function initFleetManager({ supabase, carrierUserId, driverRoot, equipmentRoot, onEquipmentChange = () => {} }) {
  if (!supabase || !carrierUserId || !driverRoot || !equipmentRoot) return;
  const el = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
  const safe = value => value == null ? '' : String(value);
  const categoryLabels={tractor:'Semi Truck / Power Unit',straight_truck:'Box Truck (Straight Truck)',box_truck:'Box Truck (Straight Truck)',cargo_van:'Cargo Van / Sprinter Van',hot_shot:'Hot Shot',dry_van:'Dry Van',flatbed:'Flatbed',reefer:'Reefer',auto_carrier:'Auto Carrier',b_train:'B-Train',conestoga:'Conestoga',container:'Container',container_insulated:'Container Insulated',container_refrigerated:'Container Refrigerated',conveyor:'Conveyor',double_drop:'Double Drop',dump_trailer:'Dump Trailer',flatbed_air_ride:'Flatbed Air Ride',flatbed_conestoga:'Flatbed Conestoga',flatbed_double:'Flatbed Double',flatbed_hotshot:'Flatbed Hotshot',flatbed_maxi:'Flatbed Maxi',flatbed_overdimension:'Flatbed Overdimension',flatbed_with_chains:'Flatbed with Chains',flatbed_with_sides:'Flatbed with Sides',flatbed_with_tarps:'Flatbed with Tarps',hopper_bottom:'Hopper Bottom',insulated_van:'Insulated Van',lowboy:'Lowboy',moving_van:'Moving Van',pneumatic:'Pneumatic',reefer_air_ride:'Reefer Air Ride',reefer_double:'Reefer Double',reefer_hazmat:'Reefer Hazmat',reefer_intermodal:'Reefer Intermodal',reefer_logistics:'Reefer Logistics',reefer_pallet_exchange:'Reefer with Pallet Exchange',rgn:'Removable Gooseneck (RGN)',step_deck:'Step Deck',step_deck_conestoga:'Step Deck Conestoga',stretch_trailer:'Stretch Trailer',tanker:'Tanker',tanker_aluminum:'Tanker Aluminum',tanker_intermodal:'Tanker Intermodal',tanker_steel:'Tanker Steel',van_air_ride:'Van Air Ride',van_conestoga:'Van Conestoga',van_double:'Van Double',van_hazmat:'Van Hazmat',van_hotshot:'Van Hotshot',van_insulated:'Van Insulated',van_intermodal:'Van Intermodal',van_lift_gate:'Van Lift Gate',van_open_top:'Van Open Top',van_roller_bed:'Van Roller Bed',van_triple:'Van Triple',van_vented:'Van Vented',van_blanket_wrap:'Van with Blanket Wrap',van_curtains:'Van with Curtains',van_pallet_exchange:'Van with Pallet Exchange',box:'Box (legacy)'};
  const status = el('div','notice'); status.hidden=true;
  const say = (message, error=false) => { status.textContent=message; status.className='notice '+(error?'error':'success'); status.hidden=false; };
  const card = (title, copy) => { const c=el('section','card fleet-card'); c.append(el('h2','',title),el('p','muted',copy)); return c; };
  const field = (form, label, name, type='text', options=null, value='') => {
    const wrap=el('label','fleet-field'); wrap.append(el('span','',label));
    let input;
    if(options){ input=el('select'); input.append(new Option('Select…','')); for(const [v,t] of options)input.append(new Option(t,v)); }
    else { input=el('input'); input.type=type; if(type==='number')input.step='any'; }
    input.name=name; input.value=safe(value); wrap.append(input); form.append(wrap); return input;
  };
  const formCard = (heading, definitions, onSave, submitLabel='Save') => {
    const c=card(heading,'Fields marked optional can be left blank.');
    const form=el('form','fleet-form');
    const grid=el('div','fleet-form-grid');
    form.append(grid); c.append(form);
    const refs={};
    for(const d of definitions){ const oldParent=form; const temp=el('div'); const input=field(temp,d.label,d.name,d.type||'text',d.options,d.value||''); const wrap=input.parentElement; if(d.full)wrap.classList.add('fleet-full'); if(d.name==='has_liftgate'){input.type='checkbox';input.checked=Boolean(d.value);wrap.querySelector('span').textContent=d.label;} refs[d.name]=input; grid.append(wrap); }
    const actions=el('div','fleet-actions'); const save=el('button','button primary',submitLabel);save.type='submit';actions.append(save);form.append(actions);
    form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;try{await onSave(Object.fromEntries(new FormData(form).entries()),refs); }catch(err){say(err.message||'Could not save this record.',true)}finally{save.disabled=false}});
    return {card:c,form,refs};
  };
  const openFile = async path => { const {data,error}=await supabase.storage.from('carrier-documents').createSignedUrl(path,300); if(error)throw error; window.open(data.signedUrl,'_blank','noopener'); };
  const uploadDocument = async (kind, record, file, docType, expiresOn, notes) => {
    if(!file)throw new Error('Choose a file first.');
    if(!['application/pdf','image/jpeg','image/png'].includes(file.type)||file.size>50*1024*1024)throw new Error('Use a PDF, JPG, or PNG no larger than 50 MB.');
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]+/g,'-');
    const path=carrierUserId+'/fleet/'+kind+'/'+record+'/'+crypto.randomUUID()+'-'+safeName;
    const {error:up}=await supabase.storage.from('carrier-documents').upload(path,file,{contentType:file.type,upsert:false});
    if(up)throw up;
    const table=kind==='drivers'?'carrier_driver_documents':'carrier_equipment_documents';
    const payload={carrier_user_id:carrierUserId,document_type:docType,file_name:file.name,file_path:path,content_type:file.type,expires_on:expiresOn||null,notes:notes||null};
    payload[kind==='drivers'?'driver_id':'equipment_id']=record;
    const {error:ins}=await supabase.from(table).insert(payload);
    if(ins){await supabase.storage.from('carrier-documents').remove([path]);throw ins;}
  };
  const docSection = (kind, recordId, docs, reload) => {
    const wrap=el('div','fleet-docs');
    const form=el('form','fleet-upload');
    const type=el('select'); const choices=kind==='drivers'?[['cdl','CDL'],['medical_card','Medical card'],['driver_photo','Driver photo'],['other','Other']]:[['tractor_side_door','Tractor side door / company identifiers'],['rear_plate','Rear trailer plate'],['exterior_photo','Full exterior photo'],['interior_photo','Trailer interior'],['vin_sticker','VIN sticker'],['registration','Registration'],['cab_card','Cab card'],['insurance','Insurance'],['other','Other']];
    choices.forEach(([v,t])=>type.append(new Option(t,v)));
    const file=el('input');file.type='file';file.accept='.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';file.required=true;
    const expires=el('input');expires.type='date';
    const upload=el('button','button','Upload document / photo');upload.type='submit';
    form.append(type,file,expires,upload);wrap.append(form);
    form.addEventListener('submit',async e=>{e.preventDefault();upload.disabled=true;try{await uploadDocument(kind,recordId,file.files[0],type.value,expires.value,'');say('File uploaded.');await reload();}catch(err){say(err.message,true)}finally{upload.disabled=false}});
    const list=el('div','fleet-doc-list');
    for(const d of docs||[]){const line=el('div','fleet-doc-row');line.append(el('span','',d.file_name+' · '+d.document_type.replaceAll('_',' ')));const open=el('button','button','View');open.type='button';open.addEventListener('click',()=>openFile(d.file_path).catch(e=>say(e.message,true)));line.append(open);list.append(line)}
    if(!docs?.length)list.append(el('p','muted','No documents or photos saved yet.'));
    wrap.append(list);return wrap;
  };
  const loadDrivers = async () => {
    const {data,error}=await supabase.from('carrier_drivers').select('*').eq('carrier_user_id',carrierUserId).order('is_primary_account_holder',{ascending:false}).order('display_name');
    if(error)throw error;return data||[];
  };
  const loadEquipment = async () => {
    const {data,error}=await supabase.from('carrier_equipment').select('*').eq('carrier_user_id',carrierUserId).order('equipment_kind').order('unit_number');
    if(error)throw error;return data||[];
  };
  const driverCard = (d) => {
    const c=el('details','fleet-record');const summary=el('summary');summary.append(el('strong','',d.display_name),el('span','fleet-record-meta',(d.is_primary_account_holder?'Primary account holder · ':'')+(d.driver_status||'active')+' · '+(d.phone||d.email||'No contact entered')));c.append(summary);
    const body=el('div','fleet-record-body');
    const info=el('div','fleet-info-grid');
    [['Email',d.email],['Phone',d.phone],['CDL',d.cdl_number],['CDL state / class',[d.cdl_state,d.cdl_class].filter(Boolean).join(' / ')],['CDL expiration',d.cdl_expiration],['Endorsements',(d.endorsements||[]).join(', ')],['Restrictions',d.restrictions],['Address',d.mailing_address]].forEach(([k,v])=>{const x=el('div');x.append(el('small','',k),el('strong','',v||'—'));info.append(x)});
    body.append(info);
    const actions=el('div','fleet-actions');const edit=el('button','button','Edit driver');edit.type='button';edit.addEventListener('click',()=>{const f=driverForm(d);body.prepend(f.card)});actions.append(edit);body.append(actions);
    const docsBox=el('div');body.append(docsBox);c.append(body);
    const loadDocs=async()=>{const {data,error}=await supabase.from('carrier_driver_documents').select('*').eq('carrier_user_id',carrierUserId).eq('driver_id',d.id).order('uploaded_at',{ascending:false});if(error){say(error.message,true);return}docsBox.replaceChildren(docSection('drivers',d.id,data,loadDocs))};
    loadDocs();return c;
  };
  const driverFields = d => [
    {label:'Display name',name:'display_name',value:d?.display_name||'',full:true},
    {label:'First name',name:'first_name',value:d?.first_name||''},{label:'Last name',name:'last_name',value:d?.last_name||''},
    {label:'Email',name:'email',type:'email',value:d?.email||''},{label:'Phone',name:'phone',value:d?.phone||''},
    {label:'Mailing address',name:'mailing_address',value:d?.mailing_address||'',full:true},
    {label:'CDL number',name:'cdl_number',value:d?.cdl_number||''},{label:'CDL state',name:'cdl_state',value:d?.cdl_state||''},
    {label:'CDL class',name:'cdl_class',value:d?.cdl_class||''},{label:'CDL expiration',name:'cdl_expiration',type:'date',value:d?.cdl_expiration||''},
    {label:'Endorsements (comma separated)',name:'endorsements',value:(d?.endorsements||[]).join(', '),full:true},
    {label:'Restrictions',name:'restrictions',value:d?.restrictions||'',full:true},{label:'Notes',name:'notes',value:d?.notes||'',full:true}
  ];
  const driverForm = d => {
    const {card:c,form,refs}=formCard(d?'Edit driver':'Add a driver',driverFields(d),async values=>{
      const display=values.display_name?.trim()||[values.first_name,values.last_name].filter(Boolean).join(' ').trim();
      if(!display)throw new Error('Enter a driver name.');
      const payload={carrier_user_id:carrierUserId,display_name:display,first_name:values.first_name||null,last_name:values.last_name||null,email:values.email||null,phone:values.phone||null,mailing_address:values.mailing_address||null,cdl_number:values.cdl_number||null,cdl_state:values.cdl_state||null,cdl_class:values.cdl_class||null,cdl_expiration:values.cdl_expiration||null,endorsements:(values.endorsements||'').split(',').map(x=>x.trim()).filter(Boolean),restrictions:values.restrictions||null,notes:values.notes||null};
      const q=d?supabase.from('carrier_drivers').update(payload).eq('id',d.id).eq('carrier_user_id',carrierUserId):supabase.from('carrier_drivers').insert(payload);
      const {error}=await q;if(error)throw error;say('Driver saved.');await renderDrivers();
    },d?'Save driver':'Add driver');
    const cancel=el('button','button','Cancel');cancel.type='button';cancel.addEventListener('click',()=>c.remove());form.querySelector('.fleet-actions').append(cancel);return {card:c,refs};
  };
  const renderDrivers = async () => {
    const list=driverRoot.querySelector('[data-driver-list]');list.replaceChildren();
    const data=await loadDrivers();if(!data.length)list.append(el('p','muted','No drivers are saved yet.'));else data.forEach(d=>list.append(driverCard(d)));
  };
  driverRoot.replaceChildren();
  const dhead=el('div','fleet-section-head');dhead.append(el('div','', 'Driver profiles'),el('p','muted','The primary account holder is already listed. Add employee drivers without creating portal logins.'));const addD=el('button','button primary','Add driver');addD.type='button';dhead.append(addD);driverRoot.append(dhead,status);
  const dform=el('div');driverRoot.append(dform);addD.addEventListener('click',()=>{dform.replaceChildren(driverForm(null).card)});
  const dlist=el('div','fleet-record-list');dlist.dataset.driverList='';driverRoot.append(dlist);
  const equipmentForm = (kind, record=null) => {
    const isTrailer=kind==='trailer';
    const defs=[
      {label:'Equipment category',name:'equipment_category',options:(isTrailer?[
        ['dry_van','Dry Van'],['flatbed','Flatbed'],['reefer','Reefer'],
        ['auto_carrier','Auto Carrier'],['b_train','B-Train'],['conestoga','Conestoga'],['container','Container'],['container_insulated','Container Insulated'],['container_refrigerated','Container Refrigerated'],['conveyor','Conveyor'],['double_drop','Double Drop'],['dump_trailer','Dump Trailer'],['flatbed_air_ride','Flatbed Air Ride'],['flatbed_conestoga','Flatbed Conestoga'],['flatbed_double','Flatbed Double'],['flatbed_hotshot','Flatbed Hotshot'],['flatbed_maxi','Flatbed Maxi'],['flatbed_overdimension','Flatbed Overdimension'],['flatbed_with_chains','Flatbed with Chains'],['flatbed_with_sides','Flatbed with Sides'],['flatbed_with_tarps','Flatbed with Tarps'],['hopper_bottom','Hopper Bottom'],['insulated_van','Insulated Van'],['lowboy','Lowboy'],['moving_van','Moving Van'],['pneumatic','Pneumatic'],['reefer_air_ride','Reefer Air Ride'],['reefer_double','Reefer Double'],['reefer_hazmat','Reefer Hazmat'],['reefer_intermodal','Reefer Intermodal'],['reefer_logistics','Reefer Logistics'],['reefer_pallet_exchange','Reefer with Pallet Exchange'],['rgn','Removable Gooseneck (RGN)'],['step_deck','Step Deck'],['step_deck_conestoga','Step Deck Conestoga'],['stretch_trailer','Stretch Trailer'],['tanker','Tanker'],['tanker_aluminum','Tanker Aluminum'],['tanker_intermodal','Tanker Intermodal'],['tanker_steel','Tanker Steel'],['van_air_ride','Van Air Ride'],['van_conestoga','Van Conestoga'],['van_double','Van Double'],['van_hazmat','Van Hazmat'],['van_hotshot','Van Hotshot'],['van_insulated','Van Insulated'],['van_intermodal','Van Intermodal'],['van_lift_gate','Van Lift Gate'],['van_open_top','Van Open Top'],['van_roller_bed','Van Roller Bed'],['van_triple','Van Triple'],['van_vented','Van Vented'],['van_blanket_wrap','Van with Blanket Wrap'],['van_curtains','Van with Curtains'],['van_pallet_exchange','Van with Pallet Exchange'],['other','Other'],
        ...(record?.equipment_category==='box'?[['box','Box (legacy)']]:[])
      ]:[
        ...(record?.equipment_category==='straight_truck'?[['straight_truck','Box Truck (Straight Truck)']]:[['box_truck','Box Truck (Straight Truck)']]),['cargo_van','Cargo Van / Sprinter Van'],['hot_shot','Hot Shot'],['other','Other'],['tractor','Semi Truck / Power Unit']
      ]),value:record?.equipment_category||''},
      {label:'Unit number',name:'unit_number',value:record?.unit_number||''},{label:'Year',name:'year',type:'number',value:record?.year||''},
      {label:'Make',name:'make',value:record?.make||''},{label:'Model',name:'model',value:record?.model||''},{label:'VIN',name:'vin',value:record?.vin||''},
      {label:'License plate',name:'license_plate',value:record?.license_plate||''},{label:'Plate state',name:'license_plate_state',value:record?.license_plate_state||''},
      {label:'GVWR (lbs)',name:'gvwr_lbs',type:'number',value:record?.gvwr_lbs||''},{label:'Front axle (lbs)',name:'front_axle_lbs',type:'number',value:record?.front_axle_lbs||''},{label:'Rear tandems (lbs)',name:'rear_tandem_lbs',type:'number',value:record?.rear_tandem_lbs||''},
      {label:'Overall length (in)',name:'overall_length_inches',type:'number',value:record?.overall_length_inches||''},{label:'Overall width (in)',name:'overall_width_inches',type:'number',value:record?.overall_width_inches||''},{label:'Overall height (in)',name:'overall_height_inches',type:'number',value:record?.overall_height_inches||''},
      ...(isTrailer?[
        {label:'Interior length (in)',name:'interior_length_inches',type:'number',value:record?.interior_length_inches||''},{label:'Interior width (in)',name:'interior_width_inches',type:'number',value:record?.interior_width_inches||''},{label:'Interior height (in)',name:'interior_height_inches',type:'number',value:record?.interior_height_inches||''},
        {label:'Door width clearance (in)',name:'door_width_inches',type:'number',value:record?.door_width_inches||''},{label:'Door height clearance (in)',name:'door_height_inches',type:'number',value:record?.door_height_inches||''},
        {label:'Minimum reefer temp (°F)',name:'reefer_temp_min_f',type:'number',value:record?.reefer_temp_min_f||''},{label:'Maximum reefer temp (°F)',name:'reefer_temp_max_f',type:'number',value:record?.reefer_temp_max_f||''}
      ]:[]),
      {label:'Has liftgate',name:'has_liftgate',type:'checkbox',value:record?.has_liftgate||false},
      {label:'Notes',name:'notes',value:record?.notes||'',full:true}
    ];
    const {card:c,form,refs}=formCard(record?'Edit equipment':(isTrailer?'Add trailer':'Add Semi Truck / Power Unit'),defs,async values=>{
      if(!values.equipment_category)throw new Error('Choose an equipment category.');
      const payload={carrier_user_id:carrierUserId,equipment_kind:kind,equipment_category:values.equipment_category,unit_number:values.unit_number||null,year:values.year?Number(values.year):null,make:values.make||null,model:values.model||null,vin:values.vin||null,license_plate:values.license_plate||null,license_plate_state:values.license_plate_state||null,gvwr_lbs:values.gvwr_lbs?Number(values.gvwr_lbs):null,front_axle_lbs:values.front_axle_lbs?Number(values.front_axle_lbs):null,rear_tandem_lbs:values.rear_tandem_lbs?Number(values.rear_tandem_lbs):null,overall_length_inches:values.overall_length_inches?Number(values.overall_length_inches):null,overall_width_inches:values.overall_width_inches?Number(values.overall_width_inches):null,overall_height_inches:values.overall_height_inches?Number(values.overall_height_inches):null,interior_length_inches:values.interior_length_inches?Number(values.interior_length_inches):null,interior_width_inches:values.interior_width_inches?Number(values.interior_width_inches):null,interior_height_inches:values.interior_height_inches?Number(values.interior_height_inches):null,door_width_inches:values.door_width_inches?Number(values.door_width_inches):null,door_height_inches:values.door_height_inches?Number(values.door_height_inches):null,reefer_temp_min_f:values.reefer_temp_min_f?Number(values.reefer_temp_min_f):null,reefer_temp_max_f:values.reefer_temp_max_f?Number(values.reefer_temp_max_f):null,has_liftgate:refs.has_liftgate.checked,notes:values.notes||null};
      const q=record?supabase.from('carrier_equipment').update(payload).eq('id',record.id).eq('carrier_user_id',carrierUserId):supabase.from('carrier_equipment').insert(payload);
      const {error}=await q;if(error)throw error;say('Equipment saved.');await renderEquipment();
    },record?'Save equipment':(isTrailer?'Add trailer':'Add Semi Truck / Power Unit'));
    if(isTrailer){
      const clearanceNames=['interior_length_inches','interior_width_inches','interior_height_inches','door_width_inches','door_height_inches'];
      const toggleClearance=()=>{const openDeck=['flatbed','step_deck','conestoga'].includes(refs.equipment_category.value);for(const name of clearanceNames){const wrap=refs[name]?.closest('.fleet-field');if(wrap)wrap.hidden=openDeck;}};
      refs.equipment_category.addEventListener('change',toggleClearance);toggleClearance();
    }
    const cancel=el('button','button','Cancel');cancel.type='button';cancel.addEventListener('click',()=>c.remove());form.querySelector('.fleet-actions').append(cancel);
    return c;
  };
  const equipmentCard = e => {
    const c=el('details','fleet-record');const summary=el('summary');summary.append(el('strong','',(e.unit_number?'Unit '+e.unit_number+' · ':'')+[e.year,e.make,e.model].filter(Boolean).join(' ')||categoryLabels[e.equipment_category]||e.equipment_category),el('span','fleet-record-meta',(e.equipment_kind==='tractor'?'Semi Truck / Power Unit':'Trailer')+' · '+categoryLabels[e.equipment_category]||e.equipment_category.replaceAll('_',' ')+' · VIN '+(e.vin||'—')));c.append(summary);
    const body=el('div','fleet-record-body');const info=el('div','fleet-info-grid');
    [['License plate',[e.license_plate,e.license_plate_state].filter(Boolean).join(' / ')],['GVWR',e.gvwr_lbs?e.gvwr_lbs+' lbs':'—'],['Front axle',e.front_axle_lbs?e.front_axle_lbs+' lbs':'—'],['Rear tandems',e.rear_tandem_lbs?e.rear_tandem_lbs+' lbs':'—'],['Overall dimensions',[e.overall_length_inches,e.overall_width_inches,e.overall_height_inches].map(x=>x?x+' in':null).filter(Boolean).join(' × ')||'—'],['Interior dimensions',[e.interior_length_inches,e.interior_width_inches,e.interior_height_inches].map(x=>x?x+' in':null).filter(Boolean).join(' × ')||'—'],['Door clearance',[e.door_width_inches,e.door_height_inches].map(x=>x?x+' in':null).filter(Boolean).join(' × ')||'—']].forEach(([k,v])=>{const x=el('div');x.append(el('small','',k),el('strong','',v));info.append(x)});body.append(info);
    const edit=el('button','button','Edit equipment');edit.type='button';edit.addEventListener('click',()=>body.prepend(equipmentForm(e.equipment_kind,e)));body.append(edit);
    const docsBox=el('div');body.append(docsBox);const loadDocs=async()=>{const {data,error}=await supabase.from('carrier_equipment_documents').select('*').eq('carrier_user_id',carrierUserId).eq('equipment_id',e.id).order('uploaded_at',{ascending:false});if(error){say(error.message,true);return}docsBox.replaceChildren(docSection('equipment',e.id,data,loadDocs))};loadDocs();c.append(body);return c;
  };
  const renderEquipment = async () => {
    const list=equipmentRoot.querySelector('[data-equipment-list]');list.replaceChildren();
    const data=await loadEquipment();const tractors=data.filter(x=>x.equipment_kind==='tractor'),trailers=data.filter(x=>x.equipment_kind==='trailer');
    for(const [title,items] of [['Semi Trucks / Power Units',tractors],['Trailers',trailers]]){const group=el('section','fleet-group');group.append(el('h3','',title));if(!items.length)group.append(el('p','muted','No '+title.toLowerCase()+' saved yet.'));items.forEach(x=>group.append(equipmentCard(x)));list.append(group)}
    await renderProfiles(data);
    await refreshProfileOptions();
    onEquipmentChange(tractors.length);
  };
  const renderProfiles = async equipment => {
    const box=equipmentRoot.querySelector('[data-profile-list]');box.replaceChildren();
    const {data:profiles,error}=await supabase.from('carrier_truck_profiles').select('*,carrier_truck_profile_drivers(driver_id,carrier_drivers(display_name)),tractor:carrier_equipment!carrier_truck_profiles_tractor_id_fkey(unit_number,make,model),trailer:carrier_equipment!carrier_truck_profiles_trailer_id_fkey(unit_number,make,model)').eq('carrier_user_id',carrierUserId).order('profile_name');
    if(error){box.append(el('p','muted',error.message));return}
    if(!profiles?.length){box.append(el('p','muted','No saved truck profiles yet.'));return}
    profiles.forEach(p=>{const line=el('article','fleet-record');line.append(el('strong','',p.profile_name),el('p','fleet-record-meta',(p.tractor?.unit_number||p.tractor?.make||'Semi Truck / Power Unit')+' + '+(p.is_power_only?'Power only':p.trailer?.unit_number||p.trailer?.make||'Trailer')+' · '+((p.carrier_truck_profile_drivers||[]).map(x=>x.carrier_drivers?.display_name).filter(Boolean).join(', ')||'No drivers assigned')));box.append(line)});
  };
  equipmentRoot.replaceChildren();
  const ehead=el('div','fleet-section-head');ehead.append(el('div','', 'Equipment inventory'),el('p','muted','Save tractors and trailers independently. Add photos, VIN images, plates, and equipment documents to each record.'));const addT=el('button','button primary','Add Semi Truck / Power Unit');addT.type='button';const addR=el('button','button','Add trailer');addR.type='button';ehead.append(addT,addR);equipmentRoot.append(ehead,status);
  const eform=el('div');equipmentRoot.append(eform);addT.addEventListener('click',()=>eform.replaceChildren(equipmentForm('tractor')));addR.addEventListener('click',()=>eform.replaceChildren(equipmentForm('trailer')));
  const list=el('div');list.dataset.equipmentList='';equipmentRoot.append(list);
  const profiles=card('Saved truck profiles','Pair one Semi Truck / Power Unit with an optional trailer, then assign one or more drivers. A power unit can appear in multiple saved profiles.');
  const pform=el('form','fleet-form');const pgrid=el('div','fleet-form-grid');pform.append(pgrid);profiles.append(pform);
  const pname=field(pgrid,'Profile name','profile_name');const tractor=field(pgrid,'Semi Truck / Power Unit','tractor_id','text');const trailer=field(pgrid,'Trailer (optional)','trailer_id','text');const power=field(pgrid,'Power-only (no trailer)','is_power_only','checkbox');const driverChecks=el('div','fleet-driver-checks');driverChecks.className='fleet-full';pgrid.append(driverChecks);
  const saveProfile=el('button','button primary','Save truck profile');saveProfile.type='submit';pform.append(saveProfile);pform.addEventListener('submit',async e=>{e.preventDefault();saveProfile.disabled=true;try{if(!pname.value.trim()||!tractor.value)throw new Error('Enter a profile name and select a Semi Truck / Power Unit.');if(power.checked&&trailer.value)throw new Error('Power-only profiles cannot include a trailer.');const {data,error}=await supabase.from('carrier_truck_profiles').insert({carrier_user_id:carrierUserId,profile_name:pname.value.trim(),tractor_id:tractor.value,trailer_id:power.checked?null:(trailer.value||null),is_power_only:power.checked}).select('id').single();if(error)throw error;const selected=[...driverChecks.querySelectorAll('input:checked')].map(x=>x.value);if(selected.length){const {error:assignError}=await supabase.from('carrier_truck_profile_drivers').insert(selected.map(driver_id=>({carrier_user_id:carrierUserId,truck_profile_id:data.id,driver_id})));if(assignError)throw assignError;}pform.reset();say('Truck profile saved.');await renderEquipment();}catch(err){say(err.message,true)}finally{saveProfile.disabled=false}});
  const profileList=el('div');profileList.dataset.profileList='';profiles.append(el('h3','','Saved combinations'),profileList);equipmentRoot.append(profiles);
  power.addEventListener('change',()=>{trailer.disabled=power.checked;if(power.checked)trailer.value=''});
  const refreshProfileOptions=async()=>{const [eq,ds]=await Promise.all([loadEquipment(),loadDrivers()]);const tractors=eq.filter(x=>x.equipment_kind==='tractor'),trailers=eq.filter(x=>x.equipment_kind==='trailer');tractor.replaceChildren(new Option('Select power unit…',''));tractors.forEach(x=>tractor.append(new Option((x.unit_number?'Unit '+x.unit_number+' · ':'')+[x.year,x.make,x.model].filter(Boolean).join(' ')||x.equipment_category,x.id)));trailer.replaceChildren(new Option('No trailer / choose later',''));trailers.forEach(x=>trailer.append(new Option((x.unit_number?'Unit '+x.unit_number+' · ':'')+[x.year,x.make,x.model].filter(Boolean).join(' ')||x.equipment_category,x.id)));driverChecks.replaceChildren(el('strong','fleet-full','Assign drivers (optional)'));ds.forEach(d=>{const label=el('label');const input=el('input');input.type='checkbox';input.value=d.id;label.append(input,document.createTextNode(' '+d.display_name));driverChecks.append(label)})};
  await renderDrivers();await renderEquipment();
}
