-- Existing provisional houses become usable in the latest compatible OPEN round.
-- No automatic round is started by this migration; existing participation is preserved.
INSERT INTO round (house_id, tenant_id, territory_id, block_id, round_number, completed, mode, leave_letter)
SELECT h.id, h.tenant_id, h.territory_id, h.block_id, ri.round_number, false, ri.theme, false
FROM house h
JOIN territory t ON t.id=h.territory_id AND t.tenant_id=h.tenant_id
JOIN territory_block tb ON tb.territory_id=h.territory_id AND tb.block_id=h.block_id AND tb.tenant_id=h.tenant_id
LEFT JOIN territory_block_address tba ON tba.id=h.territory_block_address_id
JOIN LATERAL (
  SELECT r.round_number,r.theme FROM round_info r
  JOIN type ty ON ty.id=t.type_id
  WHERE r.tenant_id=h.tenant_id AND r.status='open'
    AND (t.type_id=ANY(r.type_ids) OR (cardinality(r.type_ids)=0 AND r.type=ty.name))
  ORDER BY r.round_number DESC LIMIT 1
) ri ON true
WHERE h.registration_status='pending' AND h.number<>'ghost'
  AND tb.registration_status<>'rejected' AND (tba.id IS NULL OR tba.registration_status<>'rejected')
ON CONFLICT (house_id,territory_id,block_id,tenant_id,round_number) DO NOTHING;
