ALTER TABLE "shop_memberships"
  ADD COLUMN IF NOT EXISTS "invite_expires_at" timestamptz;