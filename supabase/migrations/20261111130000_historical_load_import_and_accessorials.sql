-- Historical load import foundation and separate accessorial records.
-- This migration is intentionally additive; it does not import or modify historical load rows.

alter table public.dispatch_loads
  add column if not exists load_notes text,
  add column if not exists source_import_key text;

alter table public.dispatch_load_stops
  add column if not exists appointment_date date,
  add column if not exists appointment_label text;

alter table public.dispatch_load_financials
  add column if not exists source_rpm numeric;

alter table public.dispatch_load_financials
  add constraint dispatch_load_financials_source_rpm_check
  check (source_rpm is null or source_rpm >= 0);

create unique index if not exists dispatch_loads_carrier_source_import_key_uidx
  on public.dispatch_loads (carrier_user_id, source_import_key)
  where source_import_key is not null;

-- Collapse spreadsheet-era operational states into the five product states.
update public.dispatch_loads
set status = case
  when status = 'draft' then 'pending'
  when status in ('dispatched','at_pickup','loaded','at_delivery') then 'in_transit'
  when status = 'on_hold' then 'pending'
  else status
end
where status in ('draft','dispatched','at_pickup','loaded','at_delivery','on_hold');

alter table public.dispatch_loads
  drop constraint if exists dispatch_loads_status_check;

alter table public.dispatch_loads
  add constraint dispatch_loads_status_check
  check (status = any (array['pending'::text,'booked'::text,'in_transit'::text,'delivered'::text,'canceled'::text]));

create table if not exists public.dispatch_load_accessorials (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.dispatch_loads(id) on delete cascade,
  accessorial_type text not null default 'other'
    check (accessorial_type = any (array['detention','layover','tonu','lumper','stop_off','driver_assist','other'])),
  description text,
  amount numeric not null check (amount >= 0),
  payment_status text not null default 'pending'
    check (payment_status = any (array['pending','received','invoiced','paid'])),
  supporting_document_id uuid references public.dispatch_load_documents(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dispatch_load_accessorials_load_id_idx
  on public.dispatch_load_accessorials(load_id, created_at);

alter table public.dispatch_load_accessorials enable row level security;

drop policy if exists "Authorized users read load accessorials" on public.dispatch_load_accessorials;
create policy "Authorized users read load accessorials"
  on public.dispatch_load_accessorials for select
  using (private.can_access_dispatch_load(load_id));

drop policy if exists "Dispatchers insert load accessorials" on public.dispatch_load_accessorials;
create policy "Dispatchers insert load accessorials"
  on public.dispatch_load_accessorials for insert
  with check (private.can_manage_dispatch_load(load_id));

drop policy if exists "Dispatchers update load accessorials" on public.dispatch_load_accessorials;
create policy "Dispatchers update load accessorials"
  on public.dispatch_load_accessorials for update
  using (private.can_manage_dispatch_load(load_id))
  with check (private.can_manage_dispatch_load(load_id));

drop policy if exists "Dispatchers delete load accessorials" on public.dispatch_load_accessorials;
create policy "Dispatchers delete load accessorials"
  on public.dispatch_load_accessorials for delete
  using (private.can_manage_dispatch_load(load_id));

comment on column public.dispatch_loads.load_notes is 'Carrier-visible shipment notes; distinct from internal dispatcher notes.';
comment on column public.dispatch_loads.source_import_key is 'Stable key used to prevent duplicate historical spreadsheet imports.';
comment on column public.dispatch_load_financials.carrier_pay is 'Gross broker-to-carrier linehaul/load pay before dispatcher compensation and before separate accessorials.';
comment on column public.dispatch_load_financials.source_rpm is 'Original RPM value imported from the source load sheet; preserved independently of calculated RPM.';
comment on table public.dispatch_load_accessorials is 'Separate accessorial revenue entries; never represented as a shipment status.';
