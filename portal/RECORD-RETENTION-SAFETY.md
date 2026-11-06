# Record Retention and Relationship Safety Audit

## Purpose

Carrier records must be manageable independently. Retiring a driver, tractor, trailer, or truck profile must not erase completed or in-progress load history, documents, or unrelated carrier information.

This is an audit and implementation guardrail. It does not change the live database or portal behavior.

## Verified current design

The following was checked against the Supabase schema for project `bvrlpwkzqmqfcupqjugf` and the portal code on the main branch at commit `ede08767813d5a8ab4a694eda5ddf681f08b4f10`.

### Existing status fields

- `carrier_drivers.driver_status`: `active`, `inactive`, `on_leave`.
- `carrier_equipment.equipment_status`: `active`, `inactive`, `maintenance`.
- `carrier_truck_profiles.profile_status`: `active`, `inactive`.

The load-entry code already limits new assignments to active driver records and active truck profiles. The fleet manager currently loads driver/equipment/profile records without filtering by status, and its edit forms do not currently expose status controls. Therefore, the status fields exist but the user-facing retirement workflow is not complete.

### Load relationships

- `dispatch_loads` stores `driver_id`, `driver_user_id`, and `truck_profile_id`.
- Its foreign keys to `carrier_drivers`, `driver_profiles`, and `carrier_truck_profiles` currently use the default `NO ACTION` behavior.
- This prevents deleting a referenced driver/profile while a load still points to it. It does not delete the load.
- The load board currently resolves driver names from the current driver/profile records. It does not currently store a separate historical name/equipment snapshot. Editing a driver's name can therefore change the name shown for an old load. The current load board also does not yet render the assigned truck/trailer details in load history.

### Relationships that need stronger protection

These existing foreign keys currently use `ON DELETE CASCADE`:

- `carrier_driver_documents` → `carrier_drivers`: deleting a driver can delete the driver's document rows.
- `carrier_equipment_documents` → `carrier_equipment`: deleting equipment can delete its document rows.
- `carrier_truck_profile_drivers` → `carrier_truck_profiles`: deleting a profile can delete its current driver-assignment rows.
- `carrier_truck_profile_drivers` → `carrier_drivers`: deleting a driver can delete its current profile-assignment rows.

The profile-to-equipment foreign keys currently use `NO ACTION`, so equipment referenced by a truck profile cannot simply be deleted while that relationship exists.

The carrier-level relationships also include cascading paths. Deleting a carrier account/profile is a different, high-impact operation and must not be treated like retiring one employee or one piece of equipment.

## Required behavior going forward

1. **Retirement is the normal removal operation.** Mark a driver, equipment item, or truck profile inactive; do not physically delete it.
2. **Retired records remain available for history.** They remain readable on prior loads and retain their documents.
3. **Retired records are excluded from new assignments.** Only active drivers and active truck profiles/equipment may be selected for new loads.
4. **Login access is separate from the driver's business record.** Removing or disabling a driver's portal login must not delete the carrier's driver record or load history. The existing `carrier_drivers.auth_user_id ON DELETE SET NULL` relationship already supports separating the login link from the carrier's driver record.
5. **Editing current records must not be confused with rewriting history.** Historical snapshots of driver and equipment details are a separate enhancement. Do not add them as part of a routine archive action without a separately reviewed design.
6. **Permanent deletion must be exceptional and dependency-checked.** It must never cascade-delete documents, assignments, or load records as a side effect.
7. **Carrier account deletion is separate.** It requires a dedicated retention/export/dependency review and must not be exposed as a normal fleet-management action.

## Safe implementation sequence

### Phase 1 — audit and guardrails (this change)

- Record the verified relationships and existing behavior.
- Keep production data, schema, RLS, storage policies, and account settings unchanged.
- Add a read-only SQL audit query that can be rerun after future migrations.

### Phase 2 — retirement workflow (separate code change)

- Add explicit Retire / Restore actions for drivers and equipment profiles.
- Retiring a driver must preserve the driver row and documents, remove them from new load assignment choices, and retain old load references.
- Retiring a truck profile must preserve its tractor/trailer rows and documents, and remove it from new load choices.
- If only one component (tractor or trailer) is being retired, detach/reconfigure the active profile without deleting the component record or its documents.
- Show retired items in a separate section so they can be reviewed/restored.

### Phase 3 — database delete guardrails (separate migration review)

- Replace the document/assignment cascades listed above with restrictive delete behavior so accidental hard deletes are blocked instead of silently removing dependent rows.
- Review carrier-level cascades separately.
- Apply no migration to production without a separate explicit approval after reviewing the exact SQL and deployment sequence.

### Phase 4 — historical display enhancement (separate design)

- Decide which driver and equipment attributes must be captured on a load at assignment time.
- Preserve the existing foreign-key IDs for traceability while storing immutable load-time display details if needed.
- Backfill only where reliable source data exists; do not guess historical values.

## Explicit non-goals for this audit

- No records are deleted, updated, or backfilled.
- No live schema, foreign key, RLS, storage, or Supabase settings are changed.
- No load-board workflow is changed.
- No permanent-delete button is added.
- No load snapshot columns are added.
