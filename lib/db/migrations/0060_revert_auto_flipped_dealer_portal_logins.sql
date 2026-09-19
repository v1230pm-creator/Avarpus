-- A verified mobile used to be auto-converted into a read-only dealer-portal
-- login (role dealer_owner/dealer_staff) whenever it happened to match a
-- dealer note recorded by some shop's "Add Dealer" flow — even though the
-- account never asked for or confirmed that identity. That auto-conversion
-- is removed going forward (see routes/auth.ts). This one-time backfill
-- reverts accounts that were shaped that way, back to a normal standalone
-- customer login with no shop of its own.
--
-- Accounts explicitly provisioned as dealer-portal logins (via POST /staff)
-- always have a real password hash set, even if to a random token — this is
-- the reliable signal that distinguishes a deliberate provisioning action
-- from the removed auto-conversion, which always left password_hash null.
-- Nothing is deleted: the shop's dealer row, its repairs, and this person's
-- own customer rows at other shops are untouched; only this account's own
-- role/shop/dealer pointer is reverted.
UPDATE users
SET role = 'customer', shop_id = NULL, dealer_id = NULL
WHERE role IN ('dealer_owner', 'dealer_staff')
  AND password_hash IS NULL;
