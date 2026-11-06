export async function initFleetManager({ supabase, carrierUserId, driverRoot, equipmentRoot, onEquipmentChange = () => {} }) {
  if (!supabase || !carrierUserId || !driverRoot || !equipmentRoot) return;
  const el = (tag, cls, text) => { const n=document.createElement(tag); if(cls)n.className=cls; if(text!==undefined)n.textContent=text; return n; };
  const safe = value => value == null ? '' : String(value);
  const categoryLabels={tractor:'Semi Truck / Power Unit',power_only:'Power Only',flat_step_deck:'Flat Step Deck',flat_conestoga:'Flat Conestoga',straight_truck:'Box Truck (Straight Truck)',box_truck:'Box Truck',cargo_van:'Cargo Van / Sprinter Van',hot_shot:'Hot Shot',dry_van:'Dry Van',flatbed:'Flat Bed',reefer:'Reefer',auto_carrier:'Auto Carrier',b_train:'B-Train',conestoga:'Conestoga',container:'Container',container_insulated:'Container Insulated',container_refrigerated:'Container Refrigerated',conveyor:'Conveyor',double_drop:'Double Drop',dump_trailer:'Dump Trailer',flatbed_air_ride:'Flatbed Air Ride',flatbed_conestoga:'Flatbed Conestoga',flatbed_double:'Flatbed Double',flatbed_hotshot:'Flatbed Hotshot',flatbed_maxi:'Flatbed Maxi',flatbed_overdimension:'Flatbed Overdimension',flatbed_with_chains:'Flatbed with Chains',flatbed_with_sides:'Flatbed with Sides',flatbed_with_tarps:'Flatbed with Tarps',hopper_bottom:'Hopper Bottom',insulated_van:'Insulated Van',lowboy:'Lowboy',moving_van:'Moving Van',pneumatic:'Pneumatic',reefer_air_ride:'Reefer Air Ride',reefer_double:'Reefer Double',reefer_hazmat:'Reefer Hazmat',reefer_intermodal:'Reefer Intermodal',reefer_logistics:'Reefer Logistics',reefer_pallet_exchange:'Reefer with Pallet Exchange',rgn:'Removable Gooseneck (RGN)',step_deck:'Step Deck',step_deck_conestoga:'Step Deck Conestoga',stretch_trailer:'Stretch Trailer',tanker:'Tanker',tanker_aluminum:'Tanker Aluminum',tanker_intermodal:'Tanker Intermodal',tanker_steel:'Tanker Steel',van_air_ride:'Van Air Ride',van_conestoga:'Van Conestoga',van_double:'Van Double',van_hazmat:'Van Hazmat',van_hotshot:'Van Hotshot',van_insulated:'Van Insulated',van_intermodal:'Van Intermodal',van_lift_gate:'Van Lift Gate',van_open_top:'Van Open Top',van_roller_bed:'Van Roller Bed',van_triple:'Van Triple',van_vented:'Van Vented',van_blanket_wrap:'Van with Blanket Wrap',van_curtains:'Van with Curtains',van_pallet_exchange:'Van with Pallet Exchange',box:'Box (legacy)'};
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
    const type=el('select'); const choices=kind==='drivers'?[['cdl','CDL'],['medical_card','Medical card'],['driver_photo','Driver photo'],['other','Other']]:[['tractor_side_door','Semi truck side door / company identifiers'],['rear_plate','Rear trailer plate'],['exterior_photo','Full exterior photo'],['interior_photo','Trailer interior'],['vin_sticker','VIN sticker'],['registration','Registration'],['cab_card','Cab card'],['insurance','Insurance'],['other','Other']];
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
  const categoryLabels={tractor:'Semi Truck / Power Unit',power_only:'Power Only',flat_step_deck:'Flat Step Deck',flat_conestoga:'Flat Conestoga',straight_truck:'Box Truck',box_truck:'Box Truck',cargo_van:'Cargo Van / Sprinter Van',hot_shot:'Hot Shot',dry_van:'Dry Van',flatbed:'Flatbed',reefer:'Reefer',auto_carrier:'Auto Carrier',b_train:'B-Train',conestoga:'Conestoga',container:'Container',container_insulated:'Container Insulated',container_refrigerated:'Container Refrigerated',conveyor:'Conveyor',double_drop:'Double Drop',dump_trailer:'Dump Trailer',flatbed_air_ride:'Flatbed Air Ride',flatbed_conestoga:'Flatbed Conestoga',flatbed_double:'Flatbed Double',flatbed_hotshot:'Flatbed Hotshot',flatbed_maxi:'Flatbed Maxi',flatbed_overdimension:'Flatbed Overdimension',flatbed_with_chains:'Flatbed with Chains',flatbed_with_sides:'Flatbed with Sides',flatbed_with_tarps:'Flatbed with Tarps',hopper_bottom:'Hopper Bottom',insulated_van:'Insulated Van',lowboy:'Lowboy',moving_van:'Moving Van',other:'Other',pneumatic:'Pneumatic',reefer_air_ride:'Reefer Air Ride',reefer_double:'Reefer Double',reefer_hazmat:'Reefer Hazmat',reefer_intermodal:'Reefer Intermodal',reefer_logistics:'Reefer Logistics',reefer_pallet_exchange:'Reefer with Pallet Exchange',rgn:'Removable Gooseneck (RGN)',step_deck:'Step Deck',step_deck_conestoga:'Step Deck Conestoga',stretch_trailer:'Stretch Trailer',tanker:'Tanker',tanker_aluminum:'Tanker Aluminum',tanker_intermodal:'Tanker Intermodal',tanker_steel:'Tanker Steel',van_air_ride:'Van Air Ride',van_conestoga:'Van Conestoga',van_double:'Van Double',van_hazmat:'Van Hazmat',van_hotshot:'Van Hotshot',van_insulated:'Van Insulated',van_intermodal:'Van Intermodal',van_lift_gate:'Van Lift Gate',van_open_top:'Van Open Top',van_roller_bed:'Van Roller Bed',van_triple:'Van Triple',van_vented:'Van Vented',van_blanket_wrap:'Van with Blanket Wrap',van_curtains:'Van with Curtains',van_pallet_exchange:'Van with Pallet Exchange',box:'Box (legacy)'};
  const primaryTypes=[['dry_van','Dry Van'],['flatbed','Flatbed'],['reefer','Reefer'],['power_only','Power Only']];
  const allOtherTypes=Object.entries(categoryLabels).filter(([value])=>!['tractor','power_only','dry_van','flatbed','reefer'].includes(value)).map(([value,label])=>[value,label]).sort((a,b)=>a[1].localeCompare(b[1]));
  const categoryMode=category=>['box_truck','straight_truck','box','cargo_van'].includes(category)?'vehicle':category==='power_only'?'power_only':'combination';
  const isVanStyle=category=>category==='dry_van'||category==='reefer'||category==='insulated_van'||category==='moving_van'||category.startsWith('van_');
  const isEnclosed=category=>isVanStyle(category)||['box_truck','straight_truck','box','cargo_van'].includes(category);
  const equipmentTypeOptions=()=>[
    ...primaryTypes,
    ...allOtherTypes
  ];
  const makeFields=(section,definitions,initial,refs)=>{
    const block=el('section','fleet-form-section');
    block.append(el('h3','',section));
    const grid=el('div','fleet-form-grid');
    for(const d of definitions){
      const holder=el('div');
      const fieldValue=initial?.[d.name]??d.value??'';const input=field(holder,d.label,d.name,d.type||'text',d.options,fieldValue);
      const wrap=input.parentElement;
      if(d.full)wrap.classList.add('fleet-full');
      if(d.type==='checkbox')input.checked=Boolean(initial?.[d.name]??d.value);
      if(d.placeholder)input.placeholder=d.placeholder;
      refs[d.name]=input;
      grid.append(wrap);
    }
    block.append(grid);return block;
  };
  const baseVehicleFields=(prefix,record={})=>[
    {label:'Unit number',name:prefix+'_unit_number',value:record.unit_number||''},
    {label:'Year',name:prefix+'_year',type:'number',value:record.year||''},
    {label:'Make',name:prefix+'_make',value:record.make||''},
    {label:'Model',name:prefix+'_model',value:record.model||''},
    {label:'VIN',name:prefix+'_vin',value:record.vin||''},
    {label:'License plate',name:prefix+'_license_plate',value:record.license_plate||''},
    {label:'Plate state',name:prefix+'_license_plate_state',value:record.license_plate_state||''},
    {label:'GVWR (lbs)',name:prefix+'_gvwr_lbs',type:'number',value:record.gvwr_lbs||''}
  ];
  const powerUnitFields=record=>[
    ...baseVehicleFields('tractor',record),
    {label:'Front axle (lbs)',name:'tractor_front_axle_lbs',type:'number',value:record.front_axle_lbs||''},
    {label:'Rear tandems (lbs)',name:'tractor_rear_tandem_lbs',type:'number',value:record.rear_tandem_lbs||''},
    {label:'Notes',name:'tractor_notes',value:record.notes||'',full:true}
  ];
  const trailerFields=(record,category)=>[
    ...baseVehicleFields('trailer',record),
    ...(isEnclosed(category)?[
      {label:'Total length (ft)',name:'trailer_total_length_feet',type:'number',value:record.total_length_feet||'',placeholder:'e.g. 53'},
      {label:'Door width clearance (in)',name:'trailer_door_width_inches',type:'number',value:record.door_width_inches||''},
      {label:'Door height clearance (in)',name:'trailer_door_height_inches',type:'number',value:record.door_height_inches||''}
    ]:[]),
    ...(['dry_van','box_truck','straight_truck','box'].includes(category)?[{label:'Floor type',name:'trailer_floor_type',options:[['wood','Wood'],['aluminum','Aluminum'],['other','Other']],value:record.floor_type||''}]:[]),
    ...(isVanStyle(category)?[{label:'Door type',name:'trailer_door_type',options:[['swing','Swing'],['roll_up','Roll-up']],value:record.door_type||''}]:[]),
    ...(category==='reefer'?[{label:'Minimum reefer temperature (°F)',name:'trailer_reefer_temp_min_f',type:'number',value:record.reefer_temp_min_f||''},{label:'Maximum reefer temperature (°F)',name:'trailer_reefer_temp_max_f',type:'number',value:record.reefer_temp_max_f||''}]:[]),
    {label:'Has liftgate',name:'trailer_has_liftgate',type:'checkbox',value:record.has_liftgate||false},
    {label:'Notes',name:'trailer_notes',value:record.notes||'',full:true}
  ];
  const vehicleFields=(record,category)=>[
    ...baseVehicleFields('tractor',record),
    ...(isEnclosed(category)?[
      {label:'Total body length (ft)',name:'tractor_total_length_feet',type:'number',value:record.total_length_feet||'',placeholder:'e.g. 26'},
      {label:'Door width clearance (in)',name:'tractor_door_width_inches',type:'number',value:record.door_width_inches||''},
      {label:'Door height clearance (in)',name:'tractor_door_height_inches',type:'number',value:record.door_height_inches||''}
    ]:[]),
    ...(['box_truck','straight_truck','box'].includes(category)?[{label:'Floor type',name:'tractor_floor_type',options:[['wood','Wood'],['aluminum','Aluminum'],['other','Other']],value:record.floor_type||''}]:[]),
    ...(isVanStyle(category)?[{label:'Door type',name:'tractor_door_type',options:[['swing','Swing'],['roll_up','Roll-up']],value:record.door_type||''}]:[]),
    {label:'Has liftgate',name:'tractor_has_liftgate',type:'checkbox',value:record.has_liftgate||false},
    {label:'Notes',name:'tractor_notes',value:record.notes||'',full:true}
  ];
  const numericOrNull=value=>value===''||value==null?null:Number(value);
  const buildEquipmentPayload=(kind,category,prefix,values,refs)=>{
    const isTractor=kind==='tractor';
    const read=name=>values[prefix+'_'+name]??'';
    const payload={carrier_user_id:carrierUserId,equipment_kind:kind,equipment_category:category,
      unit_number:read('unit_number')||null,year:numericOrNull(read('year')),make:read('make')||null,model:read('model')||null,
      vin:read('vin')||null,license_plate:read('license_plate')||null,license_plate_state:read('license_plate_state')||null,
      gvwr_lbs:numericOrNull(read('gvwr_lbs')),front_axle_lbs:isTractor?numericOrNull(values.tractor_front_axle_lbs):null,
      rear_tandem_lbs:isTractor?numericOrNull(values.tractor_rear_tandem_lbs):null,
      total_length_feet:numericOrNull(read('total_length_feet')),door_width_inches:numericOrNull(read('door_width_inches')),
      door_height_inches:numericOrNull(read('door_height_inches')),floor_type:read('floor_type')||null,door_type:read('door_type')||null,
      reefer_temp_min_f:numericOrNull(read('reefer_temp_min_f')),reefer_temp_max_f:numericOrNull(read('reefer_temp_max_f')),
      has_liftgate:!!refs[prefix+'_has_liftgate']?.checked,notes:read('notes')||null};
    return payload;
  };
  const profileName=(tractor,category)=>[(tractor.unit_number?'Unit '+tractor.unit_number:null),categoryLabels[category]||category.replaceAll('_',' '),[tractor.year,tractor.make,tractor.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ').slice(0,180)||'Equipment profile';
  const loadEquipmentProfiles=async()=>{
    const [profilesResult,equipment]=await Promise.all([
      supabase.from('carrier_truck_profiles').select('*').eq('carrier_user_id',carrierUserId).order('profile_name'),
      loadEquipment()
    ]);
    if(profilesResult.error)throw profilesResult.error;
    const map=new Map(equipment.map(item=>[item.id,item]));
    const profiles=(profilesResult.data||[]).map(p=>({...p,tractor:map.get(p.tractor_id)||null,trailer:p.trailer_id?map.get(p.trailer_id)||null:null}));
    const used=new Set(profiles.flatMap(p=>[p.tractor_id,p.trailer_id].filter(Boolean)));
    return {profiles,equipment,unassigned:equipment.filter(item=>!used.has(item.id))};
  };
  const equipmentProfileCard=(p,drivers)=>{
    const c=el('details','fleet-record');const category=p.trailer?.equipment_category||p.tractor?.equipment_category||'tractor';
    const title=p.profile_name||profileName(p.tractor||{},category);
    const tractorLabel=p.tractor?[(p.tractor.unit_number?'Unit '+p.tractor.unit_number:null),[p.tractor.year,p.tractor.make,p.tractor.model].filter(Boolean).join(' ')].filter(Boolean).join(' · '):'Power unit details missing';
    const trailerLabel=p.is_power_only?'Power Only':p.trailer?[(p.trailer.unit_number?'Unit '+p.trailer.unit_number:null),categoryLabels[p.trailer.equipment_category]||p.trailer.equipment_category].filter(Boolean).join(' · '):'No trailer linked';
    const summary=el('summary');summary.append(el('strong','',title),el('span','fleet-record-meta',tractorLabel+' · '+trailerLabel));c.append(summary);
    const body=el('div','fleet-record-body');const info=el('div','fleet-info-grid');
    const tractor=p.tractor||{},trailer=p.trailer||{};
    [['Equipment type',categoryLabels[category]||category],['Power unit',tractorLabel],['Power unit VIN',tractor.vin||'—'],['Trailer / body',trailerLabel],['Trailer VIN',trailer.vin||'—'],['Total length',((trailer.total_length_feet||tractor.total_length_feet)?(trailer.total_length_feet||tractor.total_length_feet)+' ft':'—')],['Door clearance',[trailer.door_width_inches||tractor.door_width_inches,trailer.door_height_inches||tractor.door_height_inches].map(v=>v?v+' in':null).filter(Boolean).join(' × ')||'—'],['Floor type',trailer.floor_type||tractor.floor_type||'—'],['Door type',trailer.door_type==='roll_up'||tractor.door_type==='roll_up'?'Roll-up':trailer.door_type||tractor.door_type?'Swing':'—'],['Assigned drivers',drivers.map(d=>d.display_name).filter(Boolean).join(', ')||'—']].forEach(([k,v])=>{const x=el('div');x.append(el('small','',k),el('strong','',v));info.append(x)});
    body.append(info);
    const actions=el('div','fleet-actions');const edit=el('button','button','Edit equipment profile');edit.type='button';edit.addEventListener('click',()=>body.prepend(combinedEquipmentForm(category,p).card));actions.append(edit);body.append(actions);
    const docsBox=el('div');body.append(docsBox);
    const loadDocs=async()=>{const boxes=[];for(const [label,record] of [['Power unit',p.tractor],['Trailer / body',p.trailer]]){if(!record)continue;const {data,error}=await supabase.from('carrier_equipment_documents').select('*').eq('carrier_user_id',carrierUserId).eq('equipment_id',record.id).order('uploaded_at',{ascending:false});if(error){say(error.message,true);continue}const group=el('section','fleet-doc-group');group.append(el('h4','',label),docSection('equipment',record.id,data,loadDocs));boxes.push(group)}docsBox.replaceChildren(...boxes)};
    loadDocs();c.append(body);return c;
  };
  const combinedEquipmentForm=(selectedCategory,existing=null)=>{
    const editing=!!existing;const category=selectedCategory||'';
    const mode=categoryMode(category);const tractor=existing?.tractor||null;const trailer=existing?.trailer||null;
    const c=card(editing?'Edit equipment profile':'Add equipment','Choose one equipment type, complete the applicable details, and save the profile once.');
    const form=el('form','fleet-form');const refs={};const typeWrap=el('label','fleet-field');typeWrap.append(el('span','', 'Equipment type'));
    const typeSelect=el('select');typeSelect.name='equipment_type';typeSelect.append(new Option('Select equipment type…',''));
    primaryTypes.forEach(([v,t])=>typeSelect.append(new Option(t,v)));
    const otherGroup=el('optgroup');otherGroup.label='Other Equipment';allOtherTypes.forEach(([v,t])=>otherGroup.append(new Option(t,v)));typeSelect.append(otherGroup);
    typeSelect.value=category;if(editing)typeSelect.disabled=true;typeWrap.append(typeSelect);form.append(typeWrap);
    const sections=el('div');form.append(sections);
    const driversWrap=el('section','fleet-form-section');driversWrap.append(el('h3','','Driver assignments'),el('p','muted','Optional. Assign one or more drivers to this equipment profile.'));
    const driverGrid=el('div','fleet-driver-checks');driversWrap.append(driverGrid);form.append(driversWrap);
    const actions=el('div','fleet-actions');const save=el('button','button primary',editing?'Save changes':'Save equipment');save.type='submit';const cancel=el('button','button','Cancel');cancel.type='button';cancel.addEventListener('click',()=>c.remove());actions.append(save,cancel);form.append(actions);c.append(form);
    const renderFields=()=>{
      sections.replaceChildren();Object.keys(refs).forEach(k=>delete refs[k]);
      const chosen=typeSelect.value;const selectedMode=categoryMode(chosen);
      if(!chosen)return;
      if(selectedMode==='combination'){
        sections.append(makeFields('Power Unit Details',powerUnitFields(tractor||{}),null,refs));
        sections.append(makeFields((categoryLabels[chosen]||chosen)+' Details',trailerFields(trailer||{},chosen),null,refs));
      }else if(selectedMode==='power_only'){
        sections.append(makeFields('Power Unit Details',powerUnitFields(tractor||{}),null,refs));
      }else{
        sections.append(makeFields('Vehicle Details',vehicleFields(tractor||{},chosen),null,refs));
      }
    };
    typeSelect.addEventListener('change',renderFields);renderFields();
    const driverLoad=async()=>{
      const {data:all,error}=await supabase.from('carrier_drivers').select('id,display_name').eq('carrier_user_id',carrierUserId).order('display_name');
      if(error)throw error;
      let selectedIds=[];
      if(existing){const {data:assigned,error:assignError}=await supabase.from('carrier_truck_profile_drivers').select('driver_id').eq('carrier_user_id',carrierUserId).eq('truck_profile_id',existing.id);if(assignError)throw assignError;selectedIds=(assigned||[]).map(x=>x.driver_id)}
      driverGrid.replaceChildren();
      if(!all?.length){driverGrid.append(el('p','muted','No driver profiles available yet.'));return}
      all.forEach(d=>{const label=el('label');const input=el('input');input.type='checkbox';input.value=d.id;input.checked=selectedIds.includes(d.id);label.append(input,document.createTextNode(' '+d.display_name));driverGrid.append(label)});
    };
    driverLoad().catch(e=>say(e.message,true));
    form.addEventListener('submit',async e=>{
      e.preventDefault();if(!typeSelect.value)return say('Choose an equipment type first.',true);
      save.disabled=true;save.textContent=editing?'Saving…':'Saving equipment…';
      const values=Object.fromEntries(new FormData(form).entries());const chosen=typeSelect.value;const chosenMode=categoryMode(chosen);
      const tractorCategory=chosenMode==='power_only'?'power_only':chosenMode==='vehicle'?chosen:'tractor';
      const trailerCategory=chosen==='hot_shot'?'flatbed_hotshot':chosen;
      const tractorPayload=buildEquipmentPayload('tractor',tractorCategory,'tractor',values,refs);
      const trailerPayload=chosenMode==='combination'?buildEquipmentPayload('trailer',trailerCategory,'trailer',values,refs):null;
      const selectedDrivers=[...driverGrid.querySelectorAll('input:checked')].map(input=>input.value);
      let createdTractor=null,createdTrailer=null,createdProfile=null;
      try{
        if(editing){
          const {error:tractorError}=await supabase.from('carrier_equipment').update(tractorPayload).eq('id',tractor.id).eq('carrier_user_id',carrierUserId);if(tractorError)throw tractorError;
          if(trailer){
            if(trailerPayload){const {error:trailerError}=await supabase.from('carrier_equipment').update(trailerPayload).eq('id',trailer.id).eq('carrier_user_id',carrierUserId);if(trailerError)throw trailerError;}
            else{const {error:detachError}=await supabase.from('carrier_truck_profiles').update({trailer_id:null,is_power_only:chosenMode==='power_only'}).eq('id',existing.id).eq('carrier_user_id',carrierUserId);if(detachError)throw detachError;}
          }else if(trailerPayload){const {data:newTrailer,error:trailerError}=await supabase.from('carrier_equipment').insert(trailerPayload).select('id').single();if(trailerError)throw trailerError;createdTrailer=newTrailer.id;}
          const profileUpdate={profile_name:profileName(tractorPayload,chosen),is_power_only:chosenMode==='power_only',updated_at:new Date().toISOString()};
          if(trailerPayload&&createdTrailer)profileUpdate.trailer_id=createdTrailer;
          if(chosenMode!=='combination')profileUpdate.trailer_id=null;
          const {error:profileError}=await supabase.from('carrier_truck_profiles').update(profileUpdate).eq('id',existing.id).eq('carrier_user_id',carrierUserId);if(profileError)throw profileError;
          const {error:clearDriversError}=await supabase.from('carrier_truck_profile_drivers').delete().eq('carrier_user_id',carrierUserId).eq('truck_profile_id',existing.id);if(clearDriversError)throw clearDriversError;
          if(selectedDrivers.length){const {error:driverError}=await supabase.from('carrier_truck_profile_drivers').insert(selectedDrivers.map(driver_id=>({carrier_user_id:carrierUserId,truck_profile_id:existing.id,driver_id})));if(driverError)throw driverError;}
        }else{
          const {data:newTractor,error:tractorError}=await supabase.from('carrier_equipment').insert(tractorPayload).select('id').single();if(tractorError)throw tractorError;createdTractor=newTractor.id;
          if(trailerPayload){const {data:newTrailer,error:trailerError}=await supabase.from('carrier_equipment').insert(trailerPayload).select('id').single();if(trailerError)throw trailerError;createdTrailer=newTrailer.id;}
          const profilePayload={carrier_user_id:carrierUserId,profile_name:profileName(tractorPayload,chosen),tractor_id:createdTractor,trailer_id:createdTrailer,is_power_only:chosenMode==='power_only'};
          const {data:newProfile,error:profileError}=await supabase.from('carrier_truck_profiles').insert(profilePayload).select('id').single();if(profileError)throw profileError;createdProfile=newProfile.id;
          if(selectedDrivers.length){const {error:driverError}=await supabase.from('carrier_truck_profile_drivers').insert(selectedDrivers.map(driver_id=>({carrier_user_id:carrierUserId,truck_profile_id:createdProfile,driver_id})));if(driverError)throw driverError;}
        }
        say(editing?'Equipment profile updated.':'Equipment profile saved.');
        await renderEquipment();c.remove();
      }catch(err){
        if(!editing){
          if(createdProfile)await supabase.from('carrier_truck_profiles').delete().eq('id',createdProfile).eq('carrier_user_id',carrierUserId);
          if(createdTrailer)await supabase.from('carrier_equipment').delete().eq('id',createdTrailer).eq('carrier_user_id',carrierUserId);
          if(createdTractor)await supabase.from('carrier_equipment').delete().eq('id',createdTractor).eq('carrier_user_id',carrierUserId);
        }else if(createdTrailer){
          await supabase.from('carrier_equipment').delete().eq('id',createdTrailer).eq('carrier_user_id',carrierUserId);
        }
        say(err.message||'Could not save equipment profile.',true);
      }finally{save.disabled=false;save.textContent=editing?'Save changes':'Save equipment'}
    });
    return {card:c,form,refs};
  };
  const renderEquipment=async()=>{
    const list=equipmentRoot.querySelector('[data-equipment-list]');list.replaceChildren();
    const {profiles,equipment,unassigned}=await loadEquipmentProfiles();
    const assignmentResult=await supabase.from('carrier_truck_profile_drivers').select('truck_profile_id,driver_id').eq('carrier_user_id',carrierUserId);
    if(assignmentResult.error)throw assignmentResult.error;
    const driverResult=await supabase.from('carrier_drivers').select('id,display_name').eq('carrier_user_id',carrierUserId);
    if(driverResult.error)throw driverResult.error;
    const driverMap=new Map((driverResult.data||[]).map(d=>[d.id,d]));
    const assignments=new Map();(assignmentResult.data||[]).forEach(a=>{if(!assignments.has(a.truck_profile_id))assignments.set(a.truck_profile_id,[]);const d=driverMap.get(a.driver_id);if(d)assignments.get(a.truck_profile_id).push(d)});
    if(profiles.length)profiles.forEach(p=>list.append(equipmentProfileCard(p,assignments.get(p.id)||[])));
    else if(!unassigned.length)list.append(el('p','muted','No equipment profiles saved yet.'));
    if(unassigned.length){
      const section=el('section','fleet-group');section.append(el('h3','','Existing equipment not yet grouped into a profile'),el('p','muted','These records were saved by the previous separate truck/trailer workflow. New equipment will be saved as one combined profile.'));
      const tractorRows=unassigned.filter(x=>x.equipment_kind==='tractor');const trailerRows=unassigned.filter(x=>x.equipment_kind==='trailer');
      unassigned.forEach(item=>section.append(el('p','fleet-record-meta',(item.equipment_kind==='tractor'?'Power unit':'Trailer')+' · '+(item.unit_number?'Unit '+item.unit_number+' · ':'')+(categoryLabels[item.equipment_category]||item.equipment_category)+' · '+([item.year,item.make,item.model].filter(Boolean).join(' ')||'Details incomplete'))));
      if(tractorRows.length===1&&trailerRows.length===1){
        const pair=el('button','button primary','Combine existing truck and trailer into one profile');pair.type='button';pair.addEventListener('click',async()=>{pair.disabled=true;const t=tractorRows[0],r=trailerRows[0];const cat=r.equipment_category||'dry_van';const {error}=await supabase.from('carrier_truck_profiles').insert({carrier_user_id:carrierUserId,profile_name:profileName(t,cat),tractor_id:t.id,trailer_id:r.id,is_power_only:false});if(error){say(error.message,true);pair.disabled=false}else{say('Existing truck and trailer are now grouped into one equipment profile.');await renderEquipment()}});section.append(pair);
      }else if(tractorRows.length===1&&tractorRows[0].equipment_category==='power_only'){
        const pair=el('button','button primary','Create Power Only profile from existing equipment');pair.type='button';pair.addEventListener('click',async()=>{pair.disabled=true;const t=tractorRows[0];const {error}=await supabase.from('carrier_truck_profiles').insert({carrier_user_id:carrierUserId,profile_name:profileName(t,'power_only'),tractor_id:t.id,trailer_id:null,is_power_only:true});if(error){say(error.message,true);pair.disabled=false}else{say('Power Only profile created.');await renderEquipment()}});section.append(pair);
      }
      list.append(section);
    }
    onEquipmentChange(equipment.filter(x=>x.equipment_kind==='tractor').length);
  };
  equipmentRoot.replaceChildren();
  const ehead=el('div','fleet-section-head');ehead.append(el('div','','Equipment profiles'),el('p','muted','Each truck and its associated trailer are entered together as one equipment profile and saved once.'));equipmentRoot.append(ehead,status);
  const add=el('button','button primary','Add equipment');add.type='button';const addWrap=el('div','fleet-actions');addWrap.append(add);equipmentRoot.append(addWrap);
  const formRoot=el('div');equipmentRoot.append(formRoot);add.addEventListener('click',()=>{formRoot.replaceChildren(combinedEquipmentForm('',null).card)});
  const list=el('div');list.dataset.equipmentList='';equipmentRoot.append(list);
  await renderEquipment();
  await renderDrivers();await renderEquipment();
}
