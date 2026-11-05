-- Carrier driver, equipment, documents, and saved truck profiles.
-- Applied to Supabase project bvrlpwkzqmqfcupqjugf.
-- Existing driver_profiles is intentionally retained for authenticated driver accounts.

create table public.carrier_drivers (
 id uuid primary key default gen_random_uuid(),
 carrier_user_id uuid not null references public.carrier_profiles(user_id) on delete cascade,
 first_name text, last_name text, display_name text not null, email text, phone text, mailing_address text,
 cdl_number text, cdl_state text, cdl_class text, cdl_expiration date,
 endorsements text[] not null default '{}', restrictions text,
 driver_status text not null default 'active' check (driver_status in ('active','inactive','on_leave')),
 is_primary_account_holder boolean not null default false,
 auth_user_id uuid references auth.users(id) on delete set null,
 notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (carrier_user_id,id)
);
create unique index carrier_drivers_one_primary_account_holder on public.carrier_drivers(carrier_user_id) where is_primary_account_holder;
create index carrier_drivers_carrier_name_idx on public.carrier_drivers(carrier_user_id,display_name);

create table public.carrier_equipment (
 id uuid primary key default gen_random_uuid(),
 carrier_user_id uuid not null references public.carrier_profiles(user_id) on delete cascade,
 equipment_kind text not null check (equipment_kind in ('tractor','trailer')),
 equipment_category text not null, unit_number text, year integer check (year is null or year between 1900 and 2200),
 make text, model text, vin text, license_plate text, license_plate_state text,
 gvwr_lbs integer check (gvwr_lbs is null or gvwr_lbs>=0),
 front_axle_lbs integer check (front_axle_lbs is null or front_axle_lbs>=0),
 rear_tandem_lbs integer check (rear_tandem_lbs is null or rear_tandem_lbs>=0),
 overall_length_inches numeric(8,2) check (overall_length_inches is null or overall_length_inches>=0),
 overall_width_inches numeric(8,2) check (overall_width_inches is null or overall_width_inches>=0),
 overall_height_inches numeric(8,2) check (overall_height_inches is null or overall_height_inches>=0),
 interior_length_inches numeric(8,2) check (interior_length_inches is null or interior_length_inches>=0),
 interior_width_inches numeric(8,2) check (interior_width_inches is null or interior_width_inches>=0),
 interior_height_inches numeric(8,2) check (interior_height_inches is null or interior_height_inches>=0),
 door_width_inches numeric(8,2) check (door_width_inches is null or door_width_inches>=0),
 door_height_inches numeric(8,2) check (door_height_inches is null or door_height_inches>=0),
 reefer_temp_min_f numeric(6,2), reefer_temp_max_f numeric(6,2),
 has_liftgate boolean not null default false,
 equipment_status text not null default 'active' check (equipment_status in ('active','inactive','maintenance')),
 notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (carrier_user_id,id)
);
create index carrier_equipment_carrier_kind_idx on public.carrier_equipment(carrier_user_id,equipment_kind);
create index carrier_equipment_vin_idx on public.carrier_equipment(vin) where vin is not null;

create table public.carrier_driver_documents (
 id uuid primary key default gen_random_uuid(),
 carrier_user_id uuid not null references public.carrier_profiles(user_id) on delete cascade,
 driver_id uuid not null, document_type text not null, file_name text not null, file_path text not null unique,
 content_type text not null, expires_on date, notes text, uploaded_at timestamptz not null default now(),
 foreign key (carrier_user_id,driver_id) references public.carrier_drivers(carrier_user_id,id) on delete cascade
);
create index carrier_driver_documents_driver_idx on public.carrier_driver_documents(carrier_user_id,driver_id);

create table public.carrier_equipment_documents (
 id uuid primary key default gen_random_uuid(),
 carrier_user_id uuid not null references public.carrier_profiles(user_id) on delete cascade,
 equipment_id uuid not null, document_type text not null, file_name text not null, file_path text not null unique,
 content_type text not null, expires_on date, notes text, uploaded_at timestamptz not null default now(),
 foreign key (carrier_user_id,equipment_id) references public.carrier_equipment(carrier_user_id,id) on delete cascade
);
create index carrier_equipment_documents_equipment_idx on public.carrier_equipment_documents(carrier_user_id,equipment_id);

create table public.carrier_truck_profiles (
 id uuid primary key default gen_random_uuid(),
 carrier_user_id uuid not null references public.carrier_profiles(user_id) on delete cascade,
 profile_name text not null, tractor_id uuid not null, trailer_id uuid, is_power_only boolean not null default false,
 profile_status text not null default 'active' check (profile_status in ('active','inactive')),
 notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique (carrier_user_id,id),
 foreign key (carrier_user_id,tractor_id) references public.carrier_equipment(carrier_user_id,id),
 foreign key (carrier_user_id,trailer_id) references public.carrier_equipment(carrier_user_id,id),
 check ((is_power_only and trailer_id is null) or not is_power_only)
);
create index carrier_truck_profiles_carrier_idx on public.carrier_truck_profiles(carrier_user_id);

create table public.carrier_truck_profile_drivers (
 id uuid primary key default gen_random_uuid(),
 carrier_user_id uuid not null references public.carrier_profiles(user_id) on delete cascade,
 truck_profile_id uuid not null, driver_id uuid not null, assigned_at timestamptz not null default now(), notes text,
 unique (carrier_user_id,truck_profile_id,driver_id),
 foreign key (carrier_user_id,truck_profile_id) references public.carrier_truck_profiles(carrier_user_id,id) on delete cascade,
 foreign key (carrier_user_id,driver_id) references public.carrier_drivers(carrier_user_id,id) on delete cascade
);
create index carrier_truck_profile_drivers_driver_idx on public.carrier_truck_profile_drivers(carrier_user_id,driver_id);

-- The trigger creates a non-login driver record for the primary account holder.
create or replace function public.tt_sync_primary_carrier_driver()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.carrier_drivers d where d.carrier_user_id=new.user_id and d.is_primary_account_holder) then
  insert into public.carrier_drivers(carrier_user_id,display_name,first_name,email,phone,is_primary_account_holder)
  values(new.user_id,coalesce(nullif(btrim(new.contact_name),''),nullif(btrim(new.business_name),''),'Primary account holder'),
   nullif(btrim(new.contact_name),''),coalesce(nullif(btrim(new.contact_email),''),nullif(btrim(new.email),'')),
   nullif(btrim(new.phone),''),true);
 end if;
 return new;
end; $$;
revoke all on function public.tt_sync_primary_carrier_driver() from public,anon,authenticated;
create trigger tt_sync_primary_carrier_driver_after_profile_insert after insert on public.carrier_profiles
for each row execute function public.tt_sync_primary_carrier_driver();

-- Backfill existing carrier accounts without replacing any existing primary driver record.
insert into public.carrier_drivers(carrier_user_id,display_name,first_name,email,phone,is_primary_account_holder)
select p.user_id,coalesce(nullif(btrim(p.contact_name),''),nullif(btrim(p.business_name),''),'Primary account holder'),
 nullif(btrim(p.contact_name),''),coalesce(nullif(btrim(p.contact_email),''),nullif(btrim(p.email),'')),nullif(btrim(p.phone),''),true
from public.carrier_profiles p
where not exists(select 1 from public.carrier_drivers d where d.carrier_user_id=p.user_id and d.is_primary_account_holder);

create or replace function public.tt_set_updated_at()
returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at=now(); return new; end; $$;
revoke all on function public.tt_set_updated_at() from public,anon,authenticated;
create trigger carrier_drivers_updated_at before update on public.carrier_drivers for each row execute function public.tt_set_updated_at();
create trigger carrier_equipment_updated_at before update on public.carrier_equipment for each row execute function public.tt_set_updated_at();
create trigger carrier_truck_profiles_updated_at before update on public.carrier_truck_profiles for each row execute function public.tt_set_updated_at();

create or replace function public.tt_validate_truck_profile_equipment()
returns trigger language plpgsql set search_path = '' as $$
declare tractor_kind text; trailer_kind text;
begin
 select equipment_kind into tractor_kind from public.carrier_equipment where id=new.tractor_id and carrier_user_id=new.carrier_user_id;
 if tractor_kind is distinct from 'tractor' then raise exception 'Selected tractor must be a tractor owned by this carrier'; end if;
 if new.trailer_id is not null then
  select equipment_kind into trailer_kind from public.carrier_equipment where id=new.trailer_id and carrier_user_id=new.carrier_user_id;
  if trailer_kind is distinct from 'trailer' then raise exception 'Selected trailer must be a trailer owned by this carrier'; end if;
 end if;
 if new.is_power_only and new.trailer_id is not null then raise exception 'Power-only profiles cannot include a trailer'; end if;
 return new;
end; $$;
revoke all on function public.tt_validate_truck_profile_equipment() from public,anon,authenticated;
create trigger carrier_truck_profiles_validate_equipment before insert or update on public.carrier_truck_profiles
for each row execute function public.tt_validate_truck_profile_equipment();

alter table public.carrier_drivers enable row level security;
alter table public.carrier_equipment enable row level security;
alter table public.carrier_driver_documents enable row level security;
alter table public.carrier_equipment_documents enable row level security;
alter table public.carrier_truck_profiles enable row level security;
alter table public.carrier_truck_profile_drivers enable row level security;

grant select,insert,update,delete on public.carrier_drivers to authenticated;
grant select,insert,update,delete on public.carrier_equipment to authenticated;
grant select,insert,update,delete on public.carrier_driver_documents to authenticated;
grant select,insert,update,delete on public.carrier_equipment_documents to authenticated;
grant select,insert,update,delete on public.carrier_truck_profiles to authenticated;
grant select,insert,update,delete on public.carrier_truck_profile_drivers to authenticated;

create policy carrier_drivers_tenant_access on public.carrier_drivers for all to authenticated
using (carrier_user_id=(select auth.uid()) or (select public.is_portal_admin()))
with check (carrier_user_id=(select auth.uid()) or (select public.is_portal_admin()));
create policy carrier_equipment_tenant_access on public.carrier_equipment for all to authenticated
using (carrier_user_id=(select auth.uid()) or (select public.is_portal_admin()))
with check (carrier_user_id=(select auth.uid()) or (select public.is_portal_admin()));
create policy carrier_driver_documents_tenant_access on public.carrier_driver_documents for all to authenticated
using (carrier_user_id=(select auth.uid()) or (select public.is_portal_admin()))
with check (carrier_user_id=(select auth.uid()) or (select public.is_portal_admin()));
create policy carrier_equipment_documents_tenant_access on public.carrier_equipment_documents for all to authenticated
using (carrier_user_id=(select auth.uid()) or (select public.is_portal_admin()))
with check (carrier_user_id=(select auth.uid()) or (select public.is_portal_admin()));
create policy carrier_truck_profiles_tenant_access on public.carrier_truck_profiles for all to authenticated
using (carrier_user_id=(select auth.uid()) or (select public.is_portal_admin()))
with check (carrier_user_id=(select auth.uid()) or (select public.is_portal_admin()));
create policy carrier_truck_profile_drivers_tenant_access on public.carrier_truck_profile_drivers for all to authenticated
using (carrier_user_id=(select auth.uid()) or (select public.is_portal_admin()))
with check (carrier_user_id=(select auth.uid()) or (select public.is_portal_admin()));

-- New scoped policies use the same carrier-user-id root folder convention as company files.
create policy tt_carrier_fleet_files_select on storage.objects for select to authenticated
using (bucket_id='carrier-documents' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select public.is_portal_admin())));
create policy tt_carrier_fleet_files_insert on storage.objects for insert to authenticated
with check (bucket_id='carrier-documents' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select public.is_portal_admin())));
create policy tt_carrier_fleet_files_update on storage.objects for update to authenticated
using (bucket_id='carrier-documents' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select public.is_portal_admin())))
with check (bucket_id='carrier-documents' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select public.is_portal_admin())));
create policy tt_carrier_fleet_files_delete on storage.objects for delete to authenticated
using (bucket_id='carrier-documents' and ((storage.foldername(name))[1]=(select auth.uid())::text or (select public.is_portal_admin())));
