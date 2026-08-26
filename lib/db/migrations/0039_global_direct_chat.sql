-- Forward-only global direct-chat scope. Business rooms retain a required shop;
-- global_direct rooms are the sole rows permitted to have no shop linkage.
ALTER TABLE "chat_rooms" ADD COLUMN IF NOT EXISTS "scope" text NOT NULL DEFAULT 'shop';
ALTER TABLE "chat_rooms" ALTER COLUMN "shop_id" DROP NOT NULL;
ALTER TABLE "chat_room_members" ALTER COLUMN "shop_id" DROP NOT NULL;
ALTER TABLE "chat_messages" ALTER COLUMN "shop_id" DROP NOT NULL;
ALTER TABLE "chat_read_state" ALTER COLUMN "shop_id" DROP NOT NULL;
ALTER TABLE "chat_provider_identities" ALTER COLUMN "shop_id" DROP NOT NULL;
ALTER TABLE "chat_contact_match_grants" ALTER COLUMN "shop_id" DROP NOT NULL;
DROP INDEX IF EXISTS "chat_rooms_shop_peer_key_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "chat_rooms_shop_peer_key_unique"
  ON "chat_rooms" ("shop_id", "peer_key")
  WHERE "scope" = 'shop' AND "peer_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "chat_rooms_global_direct_peer_key_unique"
  ON "chat_rooms" ("peer_key")
  WHERE "scope" = 'global_direct' AND "peer_key" IS NOT NULL;
ALTER TABLE "chat_rooms" DROP CONSTRAINT IF EXISTS "chat_rooms_scope_integrity";
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_scope_integrity" CHECK (
  (scope = 'shop' AND shop_id IS NOT NULL) OR
  (scope = 'global_direct' AND shop_id IS NULL AND kind = 'direct'
   AND customer_id IS NULL AND dealer_id IS NULL)
);

-- A child row must always carry precisely its parent's scope marker.  Foreign
-- keys alone cannot express this when global rooms intentionally use NULL.
CREATE OR REPLACE FUNCTION "enforce_chat_room_child_shop"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_shop_id uuid;
BEGIN
  SELECT shop_id INTO parent_shop_id FROM chat_rooms WHERE id = NEW.room_id;
  IF NOT FOUND THEN
    -- The existing room FK remains the authoritative referential constraint.
    RETURN NEW;
  END IF;
  IF NEW.shop_id IS DISTINCT FROM parent_shop_id THEN
    RAISE EXCEPTION 'chat room child shop_id must match parent room shop_id'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "chat_room_members_shop_matches_room" ON "chat_room_members";
CREATE TRIGGER "chat_room_members_shop_matches_room"
BEFORE INSERT OR UPDATE OF room_id, shop_id ON "chat_room_members"
FOR EACH ROW EXECUTE FUNCTION "enforce_chat_room_child_shop"();

DROP TRIGGER IF EXISTS "chat_messages_shop_matches_room" ON "chat_messages";
CREATE TRIGGER "chat_messages_shop_matches_room"
BEFORE INSERT OR UPDATE OF room_id, shop_id ON "chat_messages"
FOR EACH ROW EXECUTE FUNCTION "enforce_chat_room_child_shop"();

DROP TRIGGER IF EXISTS "chat_read_state_shop_matches_room" ON "chat_read_state";
CREATE TRIGGER "chat_read_state_shop_matches_room"
BEFORE INSERT OR UPDATE OF room_id, shop_id ON "chat_read_state"
FOR EACH ROW EXECUTE FUNCTION "enforce_chat_room_child_shop"();