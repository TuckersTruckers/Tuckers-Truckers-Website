import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://www.tuckerstruckers.com",
  "https://tuckerstruckers.com",
  "https://tuckerstruckers.github.io"
]);
const json = (body: unknown, status = 200, origin = "https://www.tuckerstruckers.com") =>
  new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://www.tuckerstruckers.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  }});
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", {headers:{
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://www.tuckerstruckers.com",
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods":"POST, OPTIONS", "Vary":"Origin"
  }});
  if (req.method !== "POST") return json({error:"Method not allowed."},405,origin);
  if (!allowedOrigins.has(origin)) return json({error:"Origin not allowed."},403,origin);
  const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key) return json({error:"Inquiry service is not configured."},500,origin);
  let body: Record<string, unknown>;
  try { body=await req.json(); } catch { return json({error:"Invalid request."},400,origin); }
  // Honeypot: silently accept automated form fills without storing them.
  if (typeof body.website === "string" && body.website.trim()) return json({success:true},200,origin);
  const str=(v:unknown,max=500)=>typeof v==="string"?v.trim().slice(0,max):"";
  const name=str(body.name,120), company=str(body.company,160), email=str(body.email,254).toLowerCase();
  const phone=str(body.phone,60), mc=str(body.mc_number,60), fleet=str(body.fleet_size,80);
  const support=str(body.support_requested,120), message=str(body.inquiry_message,5000);
  const equipment=Array.isArray(body.equipment_types)?body.equipment_types.filter(x=>typeof x==="string").map(x=>String(x).slice(0,80)).slice(0,20):[];
  if(!name||!email||!support||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return json({error:"Please provide your name, a valid email address, and the support you're looking for."},400,origin);
  const answers={Name:name,"Company name":company||"Not provided","Email address":email,"Phone number":phone||"Not provided","MC #":mc||"Not provided","Fleet size":fleet||"Not provided","Equipment types":equipment.join(", ")||"Not provided","Support requested":support};
  const admin=createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:record,error:insertError}=await admin.from("website_inquiries").insert({
    name,company:company||null,email,phone:phone||null,mc_number:mc||null,fleet_size:fleet||null,
    equipment_types:equipment,support_requested:support,inquiry_message:message||null,answers
  }).select("id").single();
  if(insertError) return json({error:"Your inquiry could not be saved. Please try again or email Dispatch@TuckersTruckers.com."},500,origin);

  const resendKey=Deno.env.get("RESEND_API_KEY");
  const from=Deno.env.get("RESEND_FROM_EMAIL");
  const to=Deno.env.get("INQUIRY_TO_EMAIL")||"Dispatch@TuckersTruckers.com";
  if(!resendKey||!from){
    await admin.from("website_inquiries").update({email_notification_status:"not_configured"}).eq("id",record.id);
    return json({success:true,saved:true,email_notification:"not_configured",inquiry_id:record.id},200,origin);
  }
  const rows=Object.entries(answers).map(([q,a])=>`<tr><th style="text-align:left;vertical-align:top;padding:10px;border:1px solid #ddd;background:#f5f5f5;width:34%">${esc(q)}</th><td style="padding:10px;border:1px solid #ddd">${esc(String(a))}</td></tr>`).join("");
  const html=`<div style="font-family:Arial,sans-serif;color:#191919;max-width:720px"><h2 style="margin-bottom:6px">New Website Inquiry</h2><p style="color:#666;font-size:13px">Tucker's Truckers · Submission ${esc(record.id)}</p><table style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table><section style="margin-top:22px;border:1px solid #ddd;border-radius:8px;padding:18px;background:#fafafa"><h3 style="margin:0 0 12px">Tell Us More</h3><div style="white-space:pre-wrap;line-height:1.6">${esc(message||"No additional message provided.")}</div></section></div>`;
  const textBody=Object.entries(answers).map(([q,a])=>q+": "+a).join("\n")+"\n\nTELL US MORE\n"+(message||"No additional message provided.");
  const mail=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+resendKey,"Content-Type":"application/json"},body:JSON.stringify({
    from,to:[to],reply_to:email,subject:"New Tucker's Truckers Website Inquiry — "+name,html,text:textBody
  })});
  if(!mail.ok){
    const detail=(await mail.text()).slice(0,500);
    await admin.from("website_inquiries").update({email_notification_status:"failed",email_notification_error:detail}).eq("id",record.id);
    return json({success:true,saved:true,email_notification:"failed",inquiry_id:record.id},200,origin);
  }
  await admin.from("website_inquiries").update({email_notification_status:"sent",email_notification_error:null}).eq("id",record.id);
  return json({success:true,saved:true,email_notification:"sent",inquiry_id:record.id},200,origin);
});