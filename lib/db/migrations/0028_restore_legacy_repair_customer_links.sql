-- Restore customer links for historic repairs that retained customer display
-- details but lost the nullable foreign key. Matching is always shop-scoped.
--
-- Phone is the strongest identity signal. If it does not identify exactly one
-- customer, fall back to an exact, case-insensitive name match only when that
-- name is unique in the shop. Existing links are never changed.
WITH phone_matches AS (
  SELECT
    r.id AS repair_id,
    min(c.id::text)::uuid AS customer_id
  FROM repairs r
  JOIN customers c
    ON c.shop_id = r.shop_id
   AND NULLIF(regexp_replace(c.mobile, '[^0-9]', '', 'g'), '') =
       NULLIF(regexp_replace(r.mobile, '[^0-9]', '', 'g'), '')
  WHERE r.customer_id IS NULL
    AND NULLIF(regexp_replace(r.mobile, '[^0-9]', '', 'g'), '') IS NOT NULL
  GROUP BY r.id
  HAVING count(*) = 1
)
UPDATE repairs r
SET customer_id = phone_matches.customer_id
FROM phone_matches
WHERE r.id = phone_matches.repair_id
  AND r.customer_id IS NULL;

WITH name_matches AS (
  SELECT
    r.id AS repair_id,
    min(c.id::text)::uuid AS customer_id
  FROM repairs r
  JOIN customers c
    ON c.shop_id = r.shop_id
   AND lower(btrim(c.name)) = lower(btrim(r.customer_name))
  WHERE r.customer_id IS NULL
  GROUP BY r.id
  HAVING count(*) = 1
)
UPDATE repairs r
SET customer_id = name_matches.customer_id
FROM name_matches
WHERE r.id = name_matches.repair_id
  AND r.customer_id IS NULL;

-- Keep ambiguous legacy rows untouched and make them visible in migration
-- logs so an operator can resolve them manually instead of guessing.
DO $$
DECLARE
  unresolved record;
BEGIN
  FOR unresolved IN
    SELECT
      r.repair_id AS ticket,
      r.id AS repair_uuid,
      phone_matches.total AS phone_candidates,
      name_matches.total AS name_candidates
    FROM repairs r
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total
      FROM customers c
      WHERE c.shop_id = r.shop_id
        AND NULLIF(regexp_replace(r.mobile, '[^0-9]', '', 'g'), '') IS NOT NULL
        AND NULLIF(regexp_replace(c.mobile, '[^0-9]', '', 'g'), '') =
            NULLIF(regexp_replace(r.mobile, '[^0-9]', '', 'g'), '')
    ) phone_matches ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total
      FROM customers c
      WHERE c.shop_id = r.shop_id
        AND lower(btrim(c.name)) = lower(btrim(r.customer_name))
    ) name_matches ON true
    WHERE r.customer_id IS NULL
      AND (
        phone_matches.total > 1
        OR (phone_matches.total = 0 AND name_matches.total > 1)
      )
  LOOP
    RAISE WARNING
      'Skipped legacy repair % (%) because its customer match is ambiguous: % phone candidates, % name candidates',
      unresolved.ticket,
      unresolved.repair_uuid,
      unresolved.phone_candidates,
      unresolved.name_candidates;
  END LOOP;
END $$;