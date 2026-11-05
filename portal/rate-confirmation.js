export async function initRateConfirmation({supabase,user,role,root}) {
  if(!supabase||!user||!root||!["platform_owner","dispatcher","dispatcher_admin"].includes(role))return;
  const $=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined&&text!==null)n.textContent=String(text);return n};
  const btn=(label,fn,primary=false)=>{const b=$("button",primary?"button primary":"button",label);b.type="button";b.addEventListener("click",fn);return b};
  const notice=$("div","rate-intake-notice");notice.hidden=true;
  const say=(m,bad=false)=>{notice.textContent=m;notice.className="rate-intake-notice"+(bad?" error":"");notice.hidden=false};
  const card=$("section","rate-intake-card");
  const head=$("div","rate-intake-head");head.append($("div","rate-intake-title","Upload Rate Confirmation"),$("p","","Upload the broker's original PDF or image. AI will extract the shipment details for your review. Nothing is published until you approve it."));
  const upload=$("div","rate-intake-upload");
  const carrierLabel=$("label","rate-intake-field");carrierLabel.append($("span","","Carrier"));
  const carrier=$("select");carrier.append(new Option("Select carrier",""));carrierLabel.append(carrier);
  const fileLabel=$("label","rate-intake-field");fileLabel.append($("span","","Rate confirmation (PDF, JPG, PNG)"));
  const file=$("input");file.type="file";file.accept=".pdf,.jpg,.jpeg,.png";fileLabel.append(file);
  const uploadBtn=btn("Upload and extract",()=>startExtraction(),true);upload.append(carrierLabel,fileLabel,uploadBtn);
  const list=$("div","rate-intake-list");
  const review=$("section","rate-intake-review");review.hidden=true;
  card.append(head,notice,upload,list,review);root.replaceChildren(card);

  const {data:carriers,error:carrierError}=await supabase.from("carrier_profiles").select("user_id,business_name,company_name,mc_number").order("business_name");
  if(carrierError){say("Could not load your authorized carriers: "+carrierError.message,true);return}
  (carriers||[]).forEach(c=>carrier.append(new Option((c.business_name||c.company_name||"Carrier")+" · MC "+(c.mc_number||"—"),c.user_id)));

  function field(parent,label,value,type="text",placeholder=""){
    const wrap=$("label","rate-intake-field");wrap.append($("span","",label));
    const input=$("input");input.type=type;input.value=value===null||value===undefined?"":String(value);if(placeholder)input.placeholder=placeholder;
    wrap.append(input);parent.append(wrap);return input;
  }
  function selectField(parent,label,value,options){
    const wrap=$("label","rate-intake-field");wrap.append($("span","",label));
    const input=$("select");options.forEach(([v,t])=>input.append(new Option(t,v)));input.value=value??"";
    wrap.append(input);parent.append(wrap);return input;
  }
  function evidenceFor(data,fieldName){
    const match=(data.field_evidence||[]).find(x=>x.field===fieldName);
    if(!match)return "";
    return [match.confidence?match.confidence.toUpperCase()+" confidence":null,match.page?"Page "+match.page:null,match.evidence?'"'+match.evidence+'"':null].filter(Boolean).join(" · ");
  }
  async function startExtraction(){
    const carrierId=carrier.value,f=file.files?.[0];
    if(!carrierId)return say("Select the carrier for this load first.",true);
    if(!f)return say("Choose a rate confirmation file.",true);
    if(!["application/pdf","image/jpeg","image/png"].includes(f.type))return say("Use a PDF, JPG, or PNG file.",true);
    if(f.size>20*1024*1024)return say("The maximum rate-confirmation size is 20 MB.",true);
    uploadBtn.disabled=true;uploadBtn.textContent="Uploading…";
    let intakeId=null,path=null;
    try{
      const {data:row,error:rowError}=await supabase.from("rate_confirmation_intakes").insert({
        carrier_user_id:carrierId,uploaded_by:user.id,original_file_path:"pending/"+crypto.randomUUID(),
        file_name:f.name,content_type:f.type,file_size_bytes:f.size,status:"uploaded"
      }).select("id").single();
      if(rowError)throw rowError;intakeId=row.id;
      path=carrierId+"/"+intakeId+"/"+crypto.randomUUID()+"-"+f.name.replace(/[^a-zA-Z0-9._-]+/g,"-");
      const {error:upError}=await supabase.storage.from("rate-confirmations").upload(path,f,{contentType:f.type,upsert:false});
      if(upError)throw upError;
      const {error:updateError}=await supabase.from("rate_confirmation_intakes").update({original_file_path:path,updated_at:new Date().toISOString()}).eq("id",intakeId);
      if(updateError)throw updateError;
      uploadBtn.textContent="Extracting…";
      const {data:result,error:invokeError}=await supabase.functions.invoke("rate-confirmation-extract",{body:{intake_id:intakeId}});
      if(invokeError)throw invokeError;
      if(result?.error)throw new Error(result.error);
      say("Extraction finished. Review every field before approving the load.");
      file.value="";await refresh();await openReview(intakeId);
    }catch(e){
      if(path)await supabase.storage.from("rate-confirmations").remove([path]);
      if(intakeId)await supabase.from("rate_confirmation_intakes").update({status:"failed",extraction_error:e.message||String(e)}).eq("id",intakeId);
      say(e.message||String(e),true);await refresh();
    }finally{uploadBtn.disabled=false;uploadBtn.textContent="Upload and extract"}
  }

  async function refresh(){
    list.replaceChildren($("div","rate-intake-loading","Loading rate confirmations…"));
    const {data,error}=await supabase.from("rate_confirmation_intakes").select("*").order("created_at",{ascending:false}).limit(50);
    if(error){list.replaceChildren($("div","rate-intake-empty",error.message));return}
    list.replaceChildren();
    if(!data?.length){list.append($("div","rate-intake-empty","No rate confirmations have been uploaded yet."));return}
    for(const item of data){
      const row=$("article","rate-intake-row");
      const summary=$("div","rate-intake-row-summary");
      const details=$("div");details.append($("strong","",item.file_name),$("span","",new Date(item.created_at).toLocaleString()+" · "+item.status.replaceAll("_"," ")));
      if(item.extraction_error)details.append($("small","rate-intake-error",item.extraction_error));
      if(item.approved_load_id)details.append($("small","","Created load "+item.approved_load_id.slice(0,8)));
      summary.append(details);
      const actions=$("div","rate-intake-row-actions");
      if(item.status==="extracted")actions.append(btn("Review extraction",()=>openReview(item.id)));
      if(item.status==="failed")actions.append(btn("Retry extraction",()=>retryExtraction(item.id)));
      if(item.status==="approved"&&item.approved_load_id)actions.append(btn("View load",()=>{window.dispatchEvent(new CustomEvent("tt-loads-updated"));say("Load created. Open the Load Board tab to view it.")}));
      row.append(summary,actions);list.append(row);
    }
  }
  async function retryExtraction(id){
    say("Retrying extraction…");
    const {data,error}=await supabase.functions.invoke("rate-confirmation-extract",{body:{intake_id:id}});
    if(error||data?.error)say(error?.message||data?.error||"Extraction failed.",true);
    else say("Extraction finished. Review the extracted fields.");
    await refresh();if(!error&&!data?.error)await openReview(id);
  }

  async function openReview(id){
    const {data:item,error}=await supabase.from("rate_confirmation_intakes").select("*").eq("id",id).single();
    if(error||!item){say(error?.message||"Could not load the extraction.",true);return}
    if(item.status!=="extracted"){say("This intake is not ready for review.",true);return}
    const original=structuredClone(item.extracted_data||{});
    const values=structuredClone(original);
    review.replaceChildren();review.hidden=false;
    const title=$("div","rate-intake-review-title");title.append($("h3","","Review extracted information"),$("p","","Check the original rate confirmation against every value. Correct anything wrong and fill in anything missing. Low-confidence fields and missing values need particular attention."));
    const source=btn("Open original confirmation",async()=>{const {data,error}=await supabase.storage.from("rate-confirmations").createSignedUrl(item.original_file_path,300);if(error)say(error.message,true);else window.open(data.signedUrl,"_blank","noopener")});
    title.append(source);review.append(title);
    const groups=[
      ["Identifiers","identifiers",[["PO number","po_number"],["Broker load number","broker_load_number"],["Pickup number","pickup_number"],["BOL number","bol_number"]]],
      ["Broker","broker",[["Brokerage","name"],["Contact name","contact_name"],["Phone","phone"],["Email","email"]]],
      ["Shipment","shipment",[["Commodity","commodity"],["Weight (lbs)","weight_lbs","number"],["Loaded miles","loaded_miles","number"],["Carrier pay ($)","carrier_pay","number"]]],
    ];
    for(const [heading,key,defs] of groups){
      const section=$("div","rate-intake-review-section");section.append($("h4","",heading));
      const grid=$("div","rate-intake-review-grid");
      for(const [label,prop,type="text"] of defs){
        const input=field(grid,label,values[key]?.[prop],type);
        input.addEventListener("input",()=>{values[key]??={};values[key][prop]=type==="number"?(input.value===""?null:Number(input.value)):(input.value.trim()||null)});
        const evidence=evidenceFor(original,key==="identifiers"?prop:key==="broker"?"broker."+prop:"shipment."+prop);
        if(evidence)grid.append($("small","rate-intake-evidence",evidence));
      }
      section.append(grid);review.append(section);
    }
    const stopsSection=$("div","rate-intake-review-section");stopsSection.append($("h4","","Pickup, delivery, and additional stops"));
    const stopCards=$("div","rate-intake-stop-list");
    (values.stops||[]).forEach((stop,index)=>{
      const stopCard=$("div","rate-intake-stop-card");stopCard.append($("h5","","Stop "+(index+1)));
      const grid=$("div","rate-intake-review-grid");
      const fields=[
        ["Stop type","stop_type","select"],["Facility","facility_name"],["Address","address_line_1"],["City","city"],["State","state"],["ZIP","postal_code"],
        ["Appointment type","appointment_type","appointment"],["Appointment date/time (include timezone offset)","appointment_start"],["Facility hours","facility_hours"],
        ["Contact name","contact_name"],["Contact phone","contact_phone"],["Contact email","contact_email"],["Instructions","instructions"]
      ];
      for(const [label,key,type] of fields){
        let input;
        if(type==="select")input=selectField(grid,label,stop[key],[["pickup","Pickup"],["delivery","Delivery"],["other","Additional stop"]]);
        else if(type==="appointment")input=selectField(grid,label,stop[key]==="unknown"?"":stop[key],[["","Select appointment type"],["appointment","Appointment"],["fcfs","FCFS"]]);
        else input=field(grid,label,stop[key]);
        input.addEventListener("change",()=>{stop[key]=input.value||null});
        input.addEventListener("input",()=>{stop[key]=input.value||null});
      }
      stopCards.append(stopCard);stopCard.append(grid);
      const seq=field(stopCard,"Stop sequence",stop.sequence,"number");seq.addEventListener("input",()=>stop.sequence=Number(seq.value)||index+1);
    });
    if(!(values.stops||[]).length)stopCards.append($("p","rate-intake-warning","No stops were identified. You must add at least one pickup and one delivery manually before approval."));
    stopsSection.append(stopCards);review.append(stopsSection);
    const notes=$("div","rate-intake-review-section");notes.append($("h4","","AI extraction notes"));
    notes.append($("p","",values.document_notes||"No additional notes from the extraction."));
    const internal=field(notes,"Internal dispatch notes",values.internal_notes||"");internal.addEventListener("input",()=>values.internal_notes=internal.value);
    review.append(notes);
    const warnings=(original.field_evidence||[]).filter(x=>x.confidence==="low"||!x.evidence);
    if(warnings.length){const warn=$("div","rate-intake-warning");warn.append($("strong","","Fields requiring extra attention"));warnings.forEach(x=>warn.append($("p","",x.field+": "+(x.evidence||"No supporting text found")+" · "+x.confidence)));review.append(warn)}
    const footer=$("div","rate-intake-review-actions");
    const close=btn("Close review",()=>{review.hidden=true});
    const approve=btn("Approve and create load",async()=>{
      const pickups=values.stops?.filter(x=>x.stop_type==="pickup")||[],deliveries=values.stops?.filter(x=>x.stop_type==="delivery")||[];
      if(!pickups.length||!deliveries.length)return say("Add at least one pickup and one delivery before approval.",true);
      if(values.stops.some(x=>!x.city||!x.state))return say("Every stop needs a city and state.",true);
      if(values.stops.some(x=>!["appointment","fcfs"].includes(x.appointment_type)))return say("Choose Appointment or FCFS for every stop.",true);
      if(values.stops.some(x=>x.appointment_start&&!/(Z|[+-]\d{2}:?\d{2})$/i.test(x.appointment_start)))return say("Add a timezone offset to every appointment date/time, or clear the date/time if it is not confirmed.",true);
      approve.disabled=true;approve.textContent="Creating load…";
      try{
        const {data:loadId,error:approveError}=await supabase.rpc("approve_rate_confirmation_intake",{target_intake_id:item.id,reviewed_data:values});
        if(approveError)throw approveError;
        say("Rate confirmation approved. Load "+String(loadId).slice(0,8)+" was created and published.");
        review.hidden=true;await refresh();window.dispatchEvent(new CustomEvent("tt-loads-updated"));
      }catch(e){say(e.message||String(e),true)}
      finally{approve.disabled=false;approve.textContent="Approve and create load"}
    },true);
    footer.append(close,approve);review.append(footer);review.scrollIntoView({behavior:"smooth",block:"start"});
  }
  await refresh();
}
