-- Fix brand name casing: Growthzone -> GrowthZone
UPDATE tenants SET brand_name = 'GrowthZone' WHERE brand_name = 'Growthzone';
ALTER TABLE tenants ALTER COLUMN brand_name SET DEFAULT 'GrowthZone';
