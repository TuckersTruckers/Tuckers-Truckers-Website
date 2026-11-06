-- Add dedicated specifications collected by the equipment-type-driven carrier inventory form.
ALTER TABLE public.carrier_equipment
  ADD COLUMN IF NOT EXISTS total_length_feet numeric,
  ADD COLUMN IF NOT EXISTS floor_type text,
  ADD COLUMN IF NOT EXISTS door_type text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='carrier_equipment_total_length_feet_check') THEN
    ALTER TABLE public.carrier_equipment ADD CONSTRAINT carrier_equipment_total_length_feet_check
      CHECK (total_length_feet IS NULL OR total_length_feet >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='carrier_equipment_floor_type_check') THEN
    ALTER TABLE public.carrier_equipment ADD CONSTRAINT carrier_equipment_floor_type_check
      CHECK (floor_type IS NULL OR floor_type IN ('wood', 'aluminum', 'other'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='carrier_equipment_door_type_check') THEN
    ALTER TABLE public.carrier_equipment ADD CONSTRAINT carrier_equipment_door_type_check
      CHECK (door_type IS NULL OR door_type IN ('swing', 'roll_up'));
  END IF;
END $$;
