-- CreateTable
CREATE TABLE "directory_sites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "adsense_client" TEXT,
    "theme_color" TEXT NOT NULL DEFAULT '#7C3AED',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ,

    CONSTRAINT "directory_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directory_companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "site_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Other',
    "logo_url" TEXT,
    "phones" TEXT[],
    "emails" TEXT[],
    "website" TEXT,
    "hours" TEXT,
    "content" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ,

    CONSTRAINT "directory_companies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "directory_sites_domain_key" ON "directory_sites"("domain");

-- CreateIndex
CREATE INDEX "directory_companies_site_id_category_idx" ON "directory_companies"("site_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "directory_companies_site_id_slug_key" ON "directory_companies"("site_id", "slug");

-- AddForeignKey
ALTER TABLE "directory_companies" ADD CONSTRAINT "directory_companies_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "directory_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
