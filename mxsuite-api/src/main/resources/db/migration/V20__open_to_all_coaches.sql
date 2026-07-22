-- Allow an org to be visible to all platform coaches without explicit assignment
ALTER TABLE tenants
    ADD COLUMN open_to_all_coaches BOOLEAN NOT NULL DEFAULT FALSE;
