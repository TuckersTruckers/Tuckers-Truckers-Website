-- Separate carrier branding from approved carrier profile and authority information.
create table if not exists public.carrier_branding (
  user_id uuid primary key references public.carrier_profiles(user_id) on delete cascade,
  logo_path text,
  updated_at timestamptz not null default now()
);
alter table public.carrier_branding enable row level security;
grant select, insert, update, delete on table public.carrier_branding to authenticated;
drop policy if exists "Carriers and admins read carrier branding" on public.carrier_branding;
create policy "Carriers and admins read carrier branding" on public.carrier_branding for select to authenticated
using (auth.uid() = user_id or (select is_portal_admin()) or private.is_dispatcher_assigned_to_carrier(user_id));
drop policy if exists "Carriers and admins insert carrier branding" on public.carrier_branding;
create policy "Carriers and admins insert carrier branding" on public.carrier_branding for insert to authenticated
with check (auth.uid() = user_id or (select is_portal_admin()));
drop policy if exists "Carriers and admins update carrier branding" on public.carrier_branding;
create policy "Carriers and admins update carrier branding" on public.carrier_branding for update to authenticated
using (auth.uid() = user_id or (select is_portal_admin()))
with check (auth.uid() = user_id or (select is_portal_admin()));
drop policy if exists "Carriers and admins delete carrier branding" on public.carrier_branding;
create policy "Carriers and admins delete carrier branding" on public.carrier_branding for delete to authenticated
using (auth.uid() = user_id or (select is_portal_admin()));
