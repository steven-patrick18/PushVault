-- RLS for the pages table (created in the previous migration)
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON pages
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
