-- Tucker's Truckers: Phase 1 internal dispatch load board.
-- Applied to the live Supabase project as dispatch_load_board_foundation and
-- tightened_driver_load_assignment_visibility.
-- All exposed public tables have RLS. Financials are separated from driver-visible load data.

create table if not exists public.dispatch_loads (
 id uuid primary key default gen_random_uuid(),
 carrier_user_id uuid not null references public.carrier_profiles(user_id) on delete restrict,
 driver_id uuid,
 truck_profile_id uuid,
 po_number text, broker_load_number text, pickup_number text, bol_number text,
 broker_name text, broker_contact_name text, broker_phone text, broker_email text, commodity text,
 weight_lbs numeric(12,2) check(weight_lbs is null or weight_lbs>=0),
 miles numeric(12,2) check(miles is null or miles>=0),
 deadhead_miles numeric(12,2) check(deadhead_miles is null or deadhead_miles>=0),
 status text not null default 'booked' check(status in('draft','booked','dispatched','at_pickup','loaded','in_transit','at_delivery','delivered','on_hold','canceled')),
 internal_notes text,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint dispatch_loads_driver_carrier_fk foreign key(carrier_user_id,driver_id) references public.carrier_drivers(carrier_user_id,id),
 constraint dispatch_loads_truck_profile_carrier_fk foreign key(carrier_user_id,truck_profile_id) references public.carrier_truck_profiles(carrier_user_id,id)
);
create index if not exists dispatch_loads_carrier_status_idx on public.dispatch_loads(carrier_user_id,status,created_at desc);
create index if not exists dispatch_loads_driver_status_idx on public.dispatch_loads(driver_id,status,created_at desc);
create index if not exists dispatch_loads_created_at_idx on public.dispatch_loads(created_at desc);

create table if not exists public.dispatch_load_financials (
 load_id uuid primary key references public.dispatch_loads(id) on delete cascade,
 carrier_pay numeric(14,2) check(carrier_pay is null or carrier_pay>=0),
 market_rpm numeric(10,4) check(market_rpm is null or market_rpm>=0),
 market_rpm_source text, market_rpm_as_of date,
 currency_code text not null default 'USD' check(currency_code ~ '^[A-Z]{3}$'),
 updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);

create table if not exists public.dispatch_load_stops (
 id uuid primary key default gen_random_uuid(),
 load_id uuid not null references public.dispatch_loads(id) on delete cascade,
 stop_order integer not null check(stop_order>0),
 stop_type text not null check(stop_type in('pickup','delivery')),
 facility_name text, address_line_1 text, address_line_2 text, city text, state text, postal_code text,
 appointment_type text not null default 'appointment' check(appointment_type in('appointment','fcfs')),
 appointment_start timestamptz, appointment_end timestamptz, facility_hours text,
 contact_name text, contact_phone text, contact_email text, instructions text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint dispatch_load_stops_order_unique unique(load_id,stop_order)
);
create index if not exists dispatch_load_stops_load_order_idx on public.dispatch_load_stops(load_id,stop_order);

create table if not exists public.dispatch_load_documents (
 id uuid primary key default gen_random_uuid(),
 load_id uuid not null references public.dispatch_loads(id) on delete cascade,
 document_type text not null check(document_type in('rate_confirmation','info_sheet','loaded_photo','bol','receipt','other')),
 file_name text not null, file_path text not null unique, content_type text not null,
 uploaded_by uuid not null references auth.users(id), uploaded_at timestamptz not null default now(), notes text
);
create index if not exists dispatch_load_documents_load_idx on public.dispatch_load_documents(load_id,uploaded_at desc);

create table if not exists public.dispatch_load_activity (
 id uuid primary key default gen_random_uuid(),
 load_id uuid not null references public.dispatch_loads(id) on delete cascade,
 event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb,
 created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create index if not exists dispatch_load_activity_load_idx on public.dispatch_load_activity(load_id,created_at desc);

alter table public.dispatch_loads enable row level security;
alter table public.dispatch_load_financials enable row level security;
alter table public.dispatch_load_stops enable row level security;
alter table public.dispatch_load_documents enable row level security;
alter table public.dispatch_load_activity enable row level security;
grant select,insert,update,delete on public.dispatch_loads,public.dispatch_load_financials,public.dispatch_load_stops,public.dispatch_load_documents,public.dispatch_load_activity to authenticated;

create or replace function private.can_manage_carrier_loads(target_carrier_user_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select (select auth.uid()) is not null and (public.is_portal_admin() or private.is_dispatcher_assigned_to_carrier(target_carrier_user_id)); $$;
revoke all on function private.can_manage_carrier_loads(uuid) from public,anon;
grant execute on function private.can_manage_carrier_loads(uuid) to authenticated;

create or replace function private.can_access_dispatch_load(target_load_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
 select (select auth.uid()) is not null and exists(
  select 1 from public.dispatch_loads l where l.id=target_load_id and (
   public.is_portal_admin() or l.carrier_user_id=(select auth.uid())
   or private.is_dispatcher_assigned_to_carrier(l.carrier_user_id)
   or exists(select 1 from public.carrier_drivers d where d.id=l.driver_id
     and d.carrier_user_id=l.carrier_user_id and d.auth_user_id=(select auth.uid()))
  )
 );
$$;
revoke all on function private.can_access_dispatch_load(uuid) from public,anon;
grant execute on function private.can_access_dispatch_load(uuid) to authenticated;

create or replace function private.can_manage_dispatch_load(target_load_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.dispatch_loads l where l.id=target_load_id and private.can_manage_carrier_loads(l.carrier_user_id)); $$;
revoke all on function private.can_manage_dispatch_load(uuid) from public,anon;
grant execute on function private.can_manage_dispatch_load(uuid) to authenticated;

create or replace function private.can_view_dispatch_load_financials(target_load_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.dispatch_loads l where l.id=target_load_id and (
  public.is_portal_admin() or l.carrier_user_id=(select auth.uid()) or private.is_dispatcher_assigned_to_carrier(l.carrier_user_id)
 ));
$$;
revoke all on function private.can_view_dispatch_load_financials(uuid) from public,anon;
grant execute on function private.can_view_dispatch_load_financials(uuid) to authenticated;

drop policy if exists "Dispatch participants read authorized loads" on public.dispatch_loads;
create policy "Dispatch participants read authorized loads" on public.dispatch_loads for select to authenticated using(private.can_access_dispatch_load(id));
drop policy if exists "Dispatchers create loads for assigned carriers" on public.dispatch_loads;
create policy "Dispatchers create loads for assigned carriers" on public.dispatch_loads for insert to authenticated with check(private.can_manage_carrier_loads(carrier_user_id) and created_by=(select auth.uid()));
drop policy if exists "Dispatchers update loads for assigned carriers" on public.dispatch_loads;
create policy "Dispatchers update loads for assigned carriers" on public.dispatch_loads for update to authenticated using(private.can_manage_carrier_loads(carrier_user_id)) with check(private.can_manage_carrier_loads(carrier_user_id));
drop policy if exists "Dispatchers delete loads for assigned carriers" on public.dispatch_loads;
create policy "Dispatchers delete loads for assigned carriers" on public.dispatch_loads for delete to authenticated using(private.can_manage_carrier_loads(carrier_user_id));

drop policy if exists "Authorized users read load financials" on public.dispatch_load_financials;
create policy "Authorized users read load financials" on public.dispatch_load_financials for select to authenticated using(private.can_view_dispatch_load_financials(load_id));
drop policy if exists "Dispatchers insert load financials" on public.dispatch_load_financials;
create policy "Dispatchers insert load financials" on public.dispatch_load_financials for insert to authenticated with check(private.can_manage_dispatch_load(load_id));
drop policy if exists "Dispatchers update load financials" on public.dispatch_load_financials;
create policy "Dispatchers update load financials" on public.dispatch_load_financials for update to authenticated using(private.can_manage_dispatch_load(load_id)) with check(private.can_manage_dispatch_load(load_id));
drop policy if exists "Dispatchers delete load financials" on public.dispatch_load_financials;
create policy "Dispatchers delete load financials" on public.dispatch_load_financials for delete to authenticated using(private.can_manage_dispatch_load(load_id));

drop policy if exists "Authorized users read load stops" on public.dispatch_load_stops;
create policy "Authorized users read load stops" on public.dispatch_load_stops for select to authenticated using(private.can_access_dispatch_load(load_id));
drop policy if exists "Dispatchers manage load stops" on public.dispatch_load_stops;
create policy "Dispatchers manage load stops" on public.dispatch_load_stops for all to authenticated using(private.can_manage_dispatch_load(load_id)) with check(private.can_manage_dispatch_load(load_id));

drop policy if exists "Authorized users read load documents" on public.dispatch_load_documents;
create policy "Authorized users read load documents" on public.dispatch_load_documents for select to authenticated using(private.can_access_dispatch_load(load_id));
drop policy if exists "Dispatchers manage load documents" on public.dispatch_load_documents;
create policy "Dispatchers manage load documents" on public.dispatch_load_documents for all to authenticated using(private.can_manage_dispatch_load(load_id)) with check(private.can_manage_dispatch_load(load_id));

drop policy if exists "Authorized users read load activity" on public.dispatch_load_activity;
create policy "Authorized users read load activity" on public.dispatch_load_activity for select to authenticated using(private.can_access_dispatch_load(load_id));
drop policy if exists "Dispatchers add load activity" on public.dispatch_load_activity;
create policy "Dispatchers add load activity" on public.dispatch_load_activity for insert to authenticated with check(private.can_manage_dispatch_load(load_id) and created_by=(select auth.uid()));

create or replace function private.touch_dispatch_load_updated_at()
returns trigger language plpgsql set search_path=''
as $$ begin new.updated_at=now(); return new; end; $$;
revoke all on function private.touch_dispatch_load_updated_at() from public,anon;
drop trigger if exists dispatch_loads_touch_updated_at on public.dispatch_loads;
create trigger dispatch_loads_touch_updated_at before update on public.dispatch_loads for each row execute function private.touch_dispatch_load_updated_at();
drop trigger if exists dispatch_load_stops_touch_updated_at on public.dispatch_load_stops;
create trigger dispatch_load_stops_touch_updated_at before update on public.dispatch_load_stops for each row execute function private.touch_dispatch_load_updated_at();

create or replace function private.log_dispatch_load_update()
returns trigger language plpgsql set search_path=''
as $$
declare changed jsonb;
begin
 changed=jsonb_build_object(
  'before',jsonb_build_object('status',old.status,'carrier_user_id',old.carrier_user_id,'driver_id',old.driver_id,'truck_profile_id',old.truck_profile_id,'po_number',old.po_number,'broker_load_number',old.broker_load_number,'pickup_number',old.pickup_number,'bol_number',old.bol_number,'miles',old.miles,'deadhead_miles',old.deadhead_miles,'weight_lbs',old.weight_lbs,'broker_name',old.broker_name),
  'after',jsonb_build_object('status',new.status,'carrier_user_id',new.carrier_user_id,'driver_id',new.driver_id,'truck_profile_id',new.truck_profile_id,'po_number',new.po_number,'broker_load_number',new.broker_load_number,'pickup_number',new.pickup_number,'bol_number',new.bol_number,'miles',new.miles,'deadhead_miles',new.deadhead_miles,'weight_lbs',new.weight_lbs,'broker_name',new.broker_name)
 );
 insert into public.dispatch_load_activity(load_id,event_type,summary,details,created_by)
 values(new.id,'load_updated','Load details updated',changed,(select auth.uid()));
 return new;
end;
$$;
revoke all on function private.log_dispatch_load_update() from public,anon;
drop trigger if exists dispatch_loads_audit_update on public.dispatch_loads;
create trigger dispatch_loads_audit_update after update on public.dispatch_loads for each row execute function private.log_dispatch_load_update();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('load-documents','load-documents',false,52428800,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do nothing;

drop policy if exists "Authorized users read dispatch load files" on storage.objects;
create policy "Authorized users read dispatch load files" on storage.objects for select to authenticated
using(bucket_id='load-documents' and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then private.can_access_dispatch_load(((storage.foldername(name))[1])::uuid) else false end);
drop policy if exists "Dispatchers upload dispatch load files" on storage.objects;
create policy "Dispatchers upload dispatch load files" on storage.objects for insert to authenticated
with check(bucket_id='load-documents' and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then private.can_manage_dispatch_load(((storage.foldername(name))[1])::uuid) else false end);
drop policy if exists "Dispatchers update dispatch load files" on storage.objects;
create policy "Dispatchers update dispatch load files" on storage.objects for update to authenticated
using(bucket_id='load-documents' and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then private.can_manage_dispatch_load(((storage.foldername(name))[1])::uuid) else false end)
with check(bucket_id='load-documents' and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then private.can_manage_dispatch_load(((storage.foldername(name))[1])::uuid) else false end);
drop policy if exists "Dispatchers delete dispatch load files" on storage.objects;
create policy "Dispatchers delete dispatch load files" on storage.objects for delete to authenticated
using(bucket_id='load-documents' and case when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then private.can_manage_dispatch_load(((storage.foldername(name))[1])::uuid) else false end);
