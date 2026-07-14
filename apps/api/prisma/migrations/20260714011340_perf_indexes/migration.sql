-- CreateIndex
CREATE INDEX "automation_jobs_subscriber_id_idx" ON "automation_jobs"("subscriber_id");

-- CreateIndex
CREATE INDEX "conversions_subscriber_id_idx" ON "conversions"("subscriber_id");

-- CreateIndex
CREATE INDEX "segments_property_id_idx" ON "segments"("property_id");

-- CreateIndex
CREATE INDEX "sends_subscriber_id_idx" ON "sends"("subscriber_id");

-- CreateIndex
CREATE INDEX "sends_tenant_id_created_at_idx" ON "sends"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "sends_campaign_id_created_at_idx" ON "sends"("campaign_id", "created_at");
