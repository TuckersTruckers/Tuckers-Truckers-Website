-- Read-only audit: foreign-key delete behavior for carrier, fleet, and load records.
-- Safe to run in Supabase SQL Editor. This query does not modify schema or data.

select
  child_ns.nspname || '.' || child.relname as child_table,
  c.conname as constraint_name,
  parent_ns.nspname || '.' || parent.relname as parent_table,
  pg_get_constraintdef(c.oid) as definition,
  case c.confdeltype
    when 'a' then 'NO ACTION'
    when 'r' then 'RESTRICT'
    when 'c' then 'CASCADE'
    when 'n' then 'SET NULL'
    when 'd' then 'SET DEFAULT'
  end as on_delete
from pg_constraint c
join pg_class child on child.oid = c.conrelid
join pg_namespace child_ns on child_ns.oid = child.relnamespace
join pg_class parent on parent.oid = c.confrelid
join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
where c.contype = 'f'
  and child_ns.nspname = 'public'
  and (
    child.relname in (
      'carrier_profiles',
      'carrier_drivers',
      'carrier_equipment',
      'carrier_driver_documents',
      'carrier_equipment_documents',
      'carrier_truck_profiles',
      'carrier_truck_profile_drivers',
      'driver_profiles',
      'dispatch_loads',
      'dispatch_load_documents',
      'dispatch_load_stops',
      'dispatch_load_financials',
      'dispatch_load_activity',
      'rate_confirmation_intakes',
      'dispatcher_carrier_assignments',
      'carrier_branding'
    )
    or parent.relname in (
      'carrier_profiles',
      'carrier_drivers',
      'carrier_equipment',
      'carrier_truck_profiles',
      'dispatch_loads'
    )
  )
order by child_table, parent_table, constraint_name;

-- Read-only audit: DELETE policies on the relevant public tables.
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'carrier_profiles',
    'carrier_drivers',
    'carrier_equipment',
    'carrier_driver_documents',
    'carrier_equipment_documents',
    'carrier_truck_profiles',
    'carrier_truck_profile_drivers',
    'driver_profiles',
    'dispatch_loads'
  )
  and cmd = 'DELETE'
order by tablename, policyname;
