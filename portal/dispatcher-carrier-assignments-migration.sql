-- Tucker's Truckers: dispatcher-to-carrier authorization foundation.
-- Applied to the live Supabase project as dispatcher_carrier_assignments_foundation.
-- Keep this file aligned with the live schema. The private helper schema is not exposed by the Data API.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.dispatcher_carrier_assignments (
  id uuid primary key default gen_random_uuid(),
  dispatcher_user_id uuid not null references auth.users(id) on delete cascade,
  carrier_user_id uuid not null references public.carrier_profiles(user_id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint dispatcher_carrier_assignments_unique unique(dispatcher_user_id,carrier_user_id)
);
create index if not exists dispatcher_carrier_assignments_dispatcher_idx on public.dispatcher_carrier_assignments(dispatcher_user_id);
create index if not exists dispatcher_carrier_assignments_carrier_idx on public.dispatcher_carrier_assignments(carrier_user_id);
alter table public.dispatcher_carrier_assignments enable row level security;
grant select on public.dispatcher_carrier_assignments to authenticated;

create or replace function private.is_dispatcher_assigned_to_carrier(target_carrier_user_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
 select (select auth.uid()) is not null and exists(
  select 1 from public.dispatcher_carrier_assignments a
  join public.portal_user_roles r on r.user_id=a.dispatcher_user_id
  where a.dispatcher_user_id=(select auth.uid())
    and a.carrier_user_id=target_carrier_user_id
    and r.role in ('dispatcher','dispatcher_admin')
 );
$$;
revoke all on function private.is_dispatcher_assigned_to_carrier(uuid) from public,anon;
grant execute on function private.is_dispatcher_assigned_to_carrier(uuid) to authenticated;

drop policy if exists "Dispatchers read their carrier assignments" on public.dispatcher_carrier_assignments;
create policy "Dispatchers read their carrier assignments" on public.dispatcher_carrier_assignments
for select to authenticated using(
 dispatcher_user_id=(select auth.uid()) and exists(
  select 1 from public.portal_user_roles r where r.user_id=(select auth.uid())
  and r.role in ('dispatcher','dispatcher_admin')
 )
);
drop policy if exists "Platform admins manage dispatcher carrier assignments" on public.dispatcher_carrier_assignments;
create policy "Platform admins manage dispatcher carrier assignments" on public.dispatcher_carrier_assignments
for all to authenticated using(public.is_portal_admin()) with check(public.is_portal_admin());

drop policy if exists "Dispatchers read assigned carrier profiles" on public.carrier_profiles;
create policy "Dispatchers read assigned carrier profiles" on public.carrier_profiles
for select to authenticated using(private.is_dispatcher_assigned_to_carrier(user_id));
drop policy if exists "Dispatchers read assigned carrier documents" on public.carrier_documents;
create policy "Dispatchers read assigned carrier documents" on public.carrier_documents
for select to authenticated using(private.is_dispatcher_assigned_to_carrier(user_id));
drop policy if exists "Dispatchers read assigned carrier setup progress" on public.portal_setup_progress;
create policy "Dispatchers read assigned carrier setup progress" on public.portal_setup_progress
for select to authenticated using(private.is_dispatcher_assigned_to_carrier(user_id));
drop policy if exists "Dispatchers read drivers for assigned carriers" on public.driver_profiles;
create policy "Dispatchers read drivers for assigned carriers" on public.driver_profiles
for select to authenticated using(carrier_user_id is not null and private.is_dispatcher_assigned_to_carrier(carrier_user_id));
drop policy if exists "Dispatchers read fleet drivers for assigned carriers" on public.carrier_drivers;
create policy "Dispatchers read fleet drivers for assigned carriers" on public.carrier_drivers
for select to authenticated using(private.is_dispatcher_assigned_to_carrier(carrier_user_id));
drop policy if exists "Dispatchers read fleet equipment for assigned carriers" on public.carrier_equipment;
create policy "Dispatchers read fleet equipment for assigned carriers" on public.carrier_equipment
for select to authenticated using(private.is_dispatcher_assigned_to_carrier(carrier_user_id));
drop policy if exists "Dispatchers read truck profiles for assigned carriers" on public.carrier_truck_profiles;
create policy "Dispatchers read truck profiles for assigned carriers" on public.carrier_truck_profiles
for select to authenticated using(private.is_dispatcher_assigned_to_carrier(carrier_user_id));
drop policy if exists "Dispatchers read truck profile drivers for assigned carriers" on public.carrier_truck_profile_drivers;
create policy "Dispatchers read truck profile drivers for assigned carriers" on public.carrier_truck_profile_drivers
for select to authenticated using(private.is_dispatcher_assigned_to_carrier(carrier_user_id));
drop policy if exists "Dispatchers read driver documents for assigned carriers" on public.carrier_driver_documents;
create policy "Dispatchers read driver documents for assigned carriers" on public.carrier_driver_documents
for select to authenticated using(private.is_dispatcher_assigned_to_carrier(carrier_user_id));
drop policy if exists "Dispatchers read equipment documents for assigned carriers" on public.carrier_equipment_documents;
create policy "Dispatchers read equipment documents for assigned carriers" on public.carrier_equipment_documents
for select to authenticated using(private.is_dispatcher_assigned_to_carrier(carrier_user_id));

drop policy if exists "TT dispatchers read assigned carrier documents" on storage.objects;
create policy "TT dispatchers read assigned carrier documents" on storage.objects
for select to authenticated using(
 bucket_id='carrier-documents' and case
  when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then private.is_dispatcher_assigned_to_carrier(((storage.foldername(name))[1])::uuid)
  else false end
);

create or replace function public.assign_dispatcher_to_carrier(dispatcher_email text,target_carrier_user_id uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare dispatcher_id uuid; assignment_id uuid;
begin
 if not public.is_portal_admin() then raise exception 'Only the platform administrator can assign dispatcher access.'; end if;
 if nullif(trim(dispatcher_email),'') is null then raise exception 'Dispatcher email is required.'; end if;
 select u.id into dispatcher_id from auth.users u join public.portal_user_roles r on r.user_id=u.id
 where lower(u.email)=lower(trim(dispatcher_email)) and r.role in ('dispatcher','dispatcher_admin') limit 1;
 if dispatcher_id is null then raise exception 'No dispatcher or dispatcher-admin account was found for that email.'; end if;
 if not exists(select 1 from public.carrier_profiles c where c.user_id=target_carrier_user_id) then raise exception 'The selected carrier profile does not exist.'; end if;
 insert into public.dispatcher_carrier_assignments(dispatcher_user_id,carrier_user_id,assigned_by)
 values(dispatcher_id,target_carrier_user_id,(select auth.uid()))
 on conflict(dispatcher_user_id,carrier_user_id) do update set assigned_by=(select auth.uid())
 returning id into assignment_id;
 return assignment_id;
end;
$$;
revoke all on function public.assign_dispatcher_to_carrier(text,uuid) from public,anon;
grant execute on function public.assign_dispatcher_to_carrier(text,uuid) to authenticated;

create or replace function public.list_dispatcher_carrier_assignments()
returns table(assignment_id uuid,dispatcher_email text,dispatcher_user_id uuid,carrier_user_id uuid,business_name text,mc_number text,dot_number text)
language plpgsql stable security definer set search_path=''
as $$
begin
 if not public.is_portal_admin() then raise exception 'Only the platform administrator can list all dispatcher assignments.'; end if;
 return query select a.id,u.email::text,a.dispatcher_user_id,a.carrier_user_id,
  coalesce(c.business_name,c.company_name),c.mc_number,c.dot_number
 from public.dispatcher_carrier_assignments a join auth.users u on u.id=a.dispatcher_user_id
 join public.carrier_profiles c on c.user_id=a.carrier_user_id
 order by lower(coalesce(u.email,'')),lower(coalesce(c.business_name,c.company_name,''));
end;
$$;
revoke all on function public.list_dispatcher_carrier_assignments() from public,anon;
grant execute on function public.list_dispatcher_carrier_assignments() to authenticated;

create or replace function public.remove_dispatcher_carrier_assignment(target_assignment_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
 if not public.is_portal_admin() then raise exception 'Only the platform administrator can remove dispatcher assignments.'; end if;
 delete from public.dispatcher_carrier_assignments where id=target_assignment_id;
end;
$$;
revoke all on function public.remove_dispatcher_carrier_assignment(uuid) from public,anon;
grant execute on function public.remove_dispatcher_carrier_assignment(uuid) to authenticated;
