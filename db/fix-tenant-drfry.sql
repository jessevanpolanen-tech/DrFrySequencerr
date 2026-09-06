-- ─────────────────────────────────────────────────────────────────────
-- One-time re-tag: Dr. Fry + FahCel share one database.
--
-- Before this fix, the old Dr. Fry backend did NOT send a `tenant`, and the
-- shared `leads.tenant` column defaults to 'fahcel' — so Dr. Fry leads were
-- saved as tenant 'fahcel'. This moves the ones that clearly came from Dr. Fry
-- back to tenant 'drfry'.
--
-- Run ONCE against the live database (Supabase → SQL editor). Safe to re-run.
-- It only ever moves 'fahcel' → 'drfry', and never touches a lead that has any
-- FahCel-sourced event, so real FahCel leads are left alone.
-- ─────────────────────────────────────────────────────────────────────

-- STEP 0 — LOOK FIRST. Run this SELECT alone and eyeball it before the UPDATE.
-- It shows, for every lead currently tagged 'fahcel', the event sources on file.
-- Anything sourced 'roi-form' / 'website' / 'dashboard' (and NOT 'fahcel-*') is
-- a Dr. Fry lead that should move. If a row looks ambiguous, resolve it by hand.
--
--   select l.tenant, l.email, l.created_at,
--          array_agg(distinct e.meta->>'source') as sources
--   from leads l
--   left join events e on e.lead_id = l.id
--   where l.tenant = 'fahcel'
--   group by l.id
--   order by l.created_at desc;

-- STEP 1 — the guarded re-tag.
-- A lead moves to 'drfry' only if it has at least one clearly-Dr.-Fry event
-- source AND has NO FahCel-sourced event. Widen the Dr. Fry source list below
-- if STEP 0 shows other sources you recognise as Dr. Fry.
update leads l
set tenant = 'drfry'
where l.tenant <> 'drfry'
  and exists (
    select 1 from events e
    where e.lead_id = l.id
      and (
        e.meta->>'source' in ('roi-form', 'website', 'dashboard', 'base44-site')
        or e.meta->>'source' like 'drfry%'
        or e.meta->>'source' like 'dr-fry%'
      )
  )
  and not exists (
    select 1 from events e
    where e.lead_id = l.id
      and e.meta->>'source' like 'fahcel%'
  );

-- STEP 2 — verify the split looks right afterwards.
--   select tenant, count(*) from leads group by tenant order by tenant;
