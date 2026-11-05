-- Phase 2: Rate confirmation intake, AI extraction, human review, and explicit approval.
create table if not exists public.rate_confirmation_intakes (
 id uuid primary key default gen_random_uuid(),
 carrier_user_id uuid not null references public.carrier_profiles(user_id) on delete cascade,
 uploaded_by uuid not null references auth.users(id),
 original_file_path text not null unique,
 file_name text not null,
 content_type text not null check(content_type in ('application/pdf','image/jpeg','image/png')),
 file_size_bytes bigint not null check(file_size_bytes > 0 and file_size_bytes <= 20971520),
 status text not null default 'uploaded' check(status in ('uploaded','extracting','extracted','failed','approved','rejected')),
 extracted_data jsonb,
 reviewed_data jsonb,
 extraction_model text,
 extraction_error text,
 extracted_at timestamptz,
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 approved_load_id uuid references public.dispatch_loads(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists rate_confirmation_intakes_carrier_created_idx on public.rate_confirmation_intakes(carrier_user_id,created_at desc);
create index if not exists rate_confirmation_intakes_status_idx on public.rate_confirmation_intakes(status,created_at desc);
alter table public.rate_confirmation_intakes enable row level security;
grant select,insert,update on public.rate_confirmation_intakes to authenticated;
create policy "Dispatchers read authorized rate confirmation intakes" on public.rate_confirmation_intakes for select to authenticated using(private.can_manage_carrier_loads(carrier_user_id));
create policy "Dispatchers create rate confirmation intakes" on public.rate_confirmation_intakes for insert to authenticated with check(private.can_manage_carrier_loads(carrier_user_id) and uploaded_by=(select auth.uid()));
create policy "Dispatchers update rate confirmation intakes" on public.rate_confirmation_intakes for update to authenticated using(private.can_manage_carrier_loads(carrier_user_id)) with check(private.can_manage_carrier_loads(carrier_user_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('rate-confirmations','rate-confirmations',false,20971520,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=20971520,allowed_mime_types=array['application/pdf','image/jpeg','image/png'];
create policy "Dispatchers upload rate confirmation originals" on storage.objects for insert to authenticated
with check(bucket_id='rate-confirmations' and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then private.can_manage_carrier_loads(((storage.foldername(name))[1])::uuid) else false end);
create policy "Dispatchers read rate confirmation originals" on storage.objects for select to authenticated
using(bucket_id='rate-confirmations' and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then private.can_manage_carrier_loads(((storage.foldername(name))[1])::uuid) else false end);
create policy "Dispatchers delete rate confirmation originals" on storage.objects for delete to authenticated
using(bucket_id='rate-confirmations' and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then private.can_manage_carrier_loads(((storage.foldername(name))[1])::uuid) else false end);

alter table public.dispatch_load_stops drop constraint if exists dispatch_load_stops_stop_type_check;
alter table public.dispatch_load_stops add constraint dispatch_load_stops_stop_type_check check(stop_type = any(array['pickup'::text,'delivery'::text,'stop'::text]));

create or replace function public.approve_rate_confirmation_intake(target_intake_id uuid, reviewed_data jsonb)
returns uuid language plpgsql security invoker set search_path=''
as $$
declare intake public.rate_confirmation_intakes%rowtype; new_load_id uuid; stop_item jsonb; stop_count integer:=0; pickup_count integer:=0; delivery_count integer:=0; stop_kind text;
begin
 if (select auth.uid()) is null then raise exception 'Authentication required.'; end if;
 select * into intake from public.rate_confirmation_intakes where id=target_intake_id for update;
 if not found then raise exception 'Rate confirmation intake was not found.'; end if;
 if not private.can_manage_carrier_loads(intake.carrier_user_id) then raise exception 'You are not authorized to approve this intake.'; end if;
 if intake.status <> 'extracted' then raise exception 'Only successfully extracted rate confirmations can be approved.'; end if;
 if jsonb_typeof(reviewed_data->'stops') <> 'array' then raise exception 'Pickup and delivery stops are required.'; end if;
 insert into public.dispatch_loads(carrier_user_id,created_by,status,po_number,broker_load_number,pickup_number,bol_number,broker_name,broker_contact_name,broker_phone,broker_email,commodity,weight_lbs,miles,internal_notes)
 values(intake.carrier_user_id,(select auth.uid()),'booked',nullif(reviewed_data#>>'{identifiers,po_number}',''),nullif(reviewed_data#>>'{identifiers,broker_load_number}',''),nullif(reviewed_data#>>'{identifiers,pickup_number}',''),nullif(reviewed_data#>>'{identifiers,bol_number}',''),nullif(reviewed_data#>>'{broker,name}',''),nullif(reviewed_data#>>'{broker,contact_name}',''),nullif(reviewed_data#>>'{broker,phone}',''),nullif(reviewed_data#>>'{broker,email}',''),nullif(reviewed_data#>>'{shipment,commodity}',''),nullif(reviewed_data#>>'{shipment,weight_lbs}','')::numeric,nullif(reviewed_data#>>'{shipment,loaded_miles}','')::numeric,nullif(reviewed_data->>'internal_notes','')) returning id into new_load_id;
 for stop_item in select value from jsonb_array_elements(reviewed_data->'stops') loop
  stop_kind:=coalesce(stop_item->>'stop_type','other');
  if stop_kind='pickup' then pickup_count:=pickup_count+1; elsif stop_kind='delivery' then delivery_count:=delivery_count+1; else stop_kind:='stop'; end if;
  stop_count:=stop_count+1;
  if nullif(stop_item->>'city','') is null or nullif(stop_item->>'state','') is null then raise exception 'Every stop must include a city and state.'; end if;
  if coalesce(stop_item->>'appointment_type','') not in ('appointment','fcfs') then raise exception 'Choose Appointment or FCFS for every stop.'; end if;
  insert into public.dispatch_load_stops(load_id,stop_order,stop_type,facility_name,address_line_1,city,state,postal_code,appointment_type,appointment_start,facility_hours,contact_name,contact_phone,contact_email,instructions)
  values(new_load_id,coalesce(nullif(stop_item->>'sequence','')::integer,stop_count),stop_kind,nullif(stop_item->>'facility_name',''),nullif(stop_item->>'address_line_1',''),nullif(stop_item->>'city',''),nullif(stop_item->>'state',''),nullif(stop_item->>'postal_code',''),stop_item->>'appointment_type',nullif(stop_item->>'appointment_start','')::timestamptz,nullif(stop_item->>'facility_hours',''),nullif(stop_item->>'contact_name',''),nullif(stop_item->>'contact_phone',''),nullif(stop_item->>'contact_email',''),nullif(stop_item->>'instructions',''));
 end loop;
 if pickup_count<1 or delivery_count<1 then raise exception 'At least one pickup and one delivery must be present.'; end if;
 insert into public.dispatch_load_financials(load_id,carrier_pay,updated_by) values(new_load_id,nullif(reviewed_data#>>'{shipment,carrier_pay}','')::numeric,(select auth.uid()));
 insert into public.dispatch_load_documents(load_id,document_type,file_name,file_path,content_type,uploaded_by,notes) values(new_load_id,'rate_confirmation',intake.file_name,intake.original_file_path,intake.content_type,intake.uploaded_by,'Original uploaded rate confirmation');
 update public.rate_confirmation_intakes set status='approved',reviewed_data=approve_rate_confirmation_intake.reviewed_data,reviewed_by=(select auth.uid()),reviewed_at=now(),approved_load_id=new_load_id,updated_at=now() where id=target_intake_id;
 return new_load_id;
end;
$$;
revoke all on function public.approve_rate_confirmation_intake(uuid,jsonb) from public,anon;
grant execute on function public.approve_rate_confirmation_intake(uuid,jsonb) to authenticated;

-- Permit cleanup only for unprocessed uploads or failed extractions.
grant delete on public.rate_confirmation_intakes to authenticated;
create policy "Dispatchers delete failed rate confirmation intakes"
on public.rate_confirmation_intakes for delete to authenticated
using(private.can_manage_carrier_loads(carrier_user_id) and status in ('uploaded','failed'));
