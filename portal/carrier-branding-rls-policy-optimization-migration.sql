-- Optimize carrier branding RLS policies to evaluate auth.uid() once per statement.
drop policy if exists "Carriers and admins read carrier branding" on public.carrier_branding;
create policy "Carriers and admins read carrier branding" on public.carrier_branding for select to authenticated
using ((select auth.uid()) = user_id or (select is_portal_admin()) or private.is_dispatcher_assigned_to_carrier(user_id));
drop policy if exists "Carriers and admins insert carrier branding" on public.carrier_branding;
create policy "Carriers and admins insert carrier branding" on public.carrier_branding for insert to authenticated
with check ((select auth.uid()) = user_id or (select is_portal_admin()));
drop policy if exists "Carriers and admins update carrier branding" on public.carrier_branding;
create policy "Carriers and admins update carrier branding" on public.carrier_branding for update to authenticated
using ((select auth.uid()) = user_id or (select is_portal_admin()))
with check ((select auth.uid()) = user_id or (select is_portal_admin()));
drop policy if exists "Carriers and admins delete carrier branding" on public.carrier_branding;
create policy "Carriers and admins delete carrier branding" on public.carrier_branding for delete to authenticated
using ((select auth.uid()) = user_id or (select is_portal_admin()));
