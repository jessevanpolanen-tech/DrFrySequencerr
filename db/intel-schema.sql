-- Lead intelligence — prospects table (run once, after db/schema.sql)
--   psql "$POSTGRES_URL" -f db/intel-schema.sql
-- or paste into the Supabase SQL console. Idempotent.
--
-- A prospect is a COMPANY found by discovery (SerpApi), not yet a lead. It is
-- kept out of `leads` on purpose: /api/leads feeds the dashboard pipeline, and
-- unqualified search hits must never appear there or be enrolled by accident.
-- A prospect becomes a lead only through POST /api/intel/promote.
--
-- stage: discovered → crawled → enriched → qualified → ready | review | no_contact
--        side exits: rejected (failed the ICP) · failed (gave up after retries)
--        final: promoted (now a lead; lead_id set)

create extension if not exists "pgcrypto";

create table if not exists prospects (
  id              uuid primary key default gen_random_uuid(),
  tenant          text not null,
  domain          text not null,
  company         text not null default '',
  stage           text not null default 'discovered',
  source_query    text not null default '',
  discovery       jsonb not null default '{}'::jsonb,  -- the search hits that surfaced it
  site            jsonb not null default '{}'::jsonb,  -- crawl: title, description, text, emails
  firmographics   jsonb not null default '{}'::jsonb,  -- size, industry, country, tech
  contacts        jsonb not null default '[]'::jsonb,  -- candidate people (waterfall)
  signals         jsonb not null default '[]'::jsonb,  -- news hits: possible triggers
  qualification   jsonb not null default '{}'::jsonb,  -- rule + LLM verdict, reasons
  personalization jsonb not null default '{}'::jsonb,  -- trigger, angle, subject, opener
  contact         jsonb not null default '{}'::jsonb,  -- the one person we'd email
  email_status    text not null default '',            -- valid | risky | unverified | invalid
  fit_score       int,
  confidence      real,
  attempts        int not null default 0,              -- claims at the CURRENT stage
  locked_until    timestamptz,                         -- claim lease, so runs don't overlap
  error           text not null default '',
  lead_id         uuid references leads(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant, domain)
);

create index if not exists prospects_work_idx on prospects (tenant, stage, updated_at);

-- The grounded personalization a promoted lead carries into its sequence
-- (read by the `<tenant>-signal` sequences in lib/sequences.js). Not exposed by
-- /api/leads, which selects its columns explicitly.
alter table leads add column if not exists intel jsonb;
