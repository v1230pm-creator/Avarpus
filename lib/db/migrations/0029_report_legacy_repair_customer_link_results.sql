-- Persist the ambiguous legacy-link report in each repair's existing audit
-- timeline. This lets staff see exactly why an old repair was not linked
-- without ever assigning a customer by guesswork.
INSERT INTO repair_events (
  shop_id,
  repair_id,
  user_name,
  user_role,
  action,
  details
)
SELECT
  r.shop_id,
  r.id,
  'System',
  'system',
  'customer_link_ambiguous',
  jsonb_build_object(
    'reason', 'ambiguous_customer_match',
    'phoneCandidates', phone_matches.total,
    'nameCandidates', name_matches.total
  )
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
  AND NOT EXISTS (
    SELECT 1
    FROM repair_events e
    WHERE e.repair_id = r.id
      AND e.action = 'customer_link_ambiguous'
  );

-- The link migration changes the records behind each customer's cached totals.
-- Recompute them using the same ledger formula used by the API, so repair
-- history, balances, and reports agree immediately after backfill.
WITH customer_stats AS (
  SELECT
    c.id,
    c.shop_id,
    count(r.id) FILTER (WHERE r.status <> 'cancelled')::int AS total_repairs,
    coalesce(
      sum(
        greatest(
          round(
            (
              greatest(
                r.repair_charge
                + r.parts_charge
                + r.service_charge
                + r.other_charge
                - r.discount,
                0
              )
              * (1 + r.tax_percent / 100)
              - r.advance
            )::numeric,
            2
          )::float,
          0
        )
      ) FILTER (WHERE r.status = 'delivered'),
      0
    )::float AS due_amount
  FROM customers c
  LEFT JOIN repairs r
    ON r.shop_id = c.shop_id
   AND r.customer_id = c.id
  GROUP BY c.id, c.shop_id
)
UPDATE customers c
SET
  total_repairs = customer_stats.total_repairs,
  due_amount = customer_stats.due_amount
FROM customer_stats
WHERE c.id = customer_stats.id
  AND c.shop_id = customer_stats.shop_id;