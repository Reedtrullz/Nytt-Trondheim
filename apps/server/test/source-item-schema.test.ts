import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const schemaPath = fileURLToPath(new URL("../src/db/schema.sql", import.meta.url));

describe("source item schema", () => {
  it("defines source_items with safe dedupe indexes and situation links", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS source_items");
    expect(schema).toContain("raw_payload jsonb NOT NULL");
    expect(schema).toContain("normalized_payload jsonb NOT NULL");
    expect(schema).toContain("geo_hint geometry(Geometry, 4326)");
    expect(schema).toContain("source_items_provider_kind_external_id_unique");
    expect(schema).toContain("WHERE external_id IS NOT NULL");
    expect(schema).toContain("source_items_capture_hash_unique");
    expect(schema).toContain("role text");
    expect(schema).toContain("input_hash text");
    expect(schema).toContain("source_items_role_check");
    expect(schema).toContain("source_items_provider_input_hash_unique");
    expect(schema).toContain("fill_source_item_decision_metadata");
    expect(schema).toContain("source_items_decision_metadata_fill");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS situation_source_items");
    expect(schema).toContain("relationship text NOT NULL DEFAULT 'supports'");
    expect(schema).toContain("situation_source_items_source_item_idx");
  });

  it("backfills legacy articles and official events into source items idempotently", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    expect(schema).toContain("-- Backfill existing articles into the source item ledger.");
    expect(schema).toContain("INSERT INTO source_items");
    expect(schema).toContain("FROM articles a");
    expect(schema).toContain("FROM official_events oe");
    expect(schema).toContain("ON CONFLICT (id) DO UPDATE SET");
    expect(schema).toContain(
      "digest(jsonb_build_array(a.source, 'article', a.id)::text, 'sha256')",
    );
    expect(schema).toContain(
      "digest(jsonb_build_array(oe.source, 'official_event', oe.id)::text, 'sha256')",
    );
  });

  it("backfills situation source links and keeps DATEX TravelTime out of the ledger", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("-- Backfill source-item links for legacy situation/article joins.");
    expect(schema).toContain("FROM situation_articles sa");
    expect(schema).toContain("WHERE si.kind = 'article'");
    expect(schema).toContain(
      "-- Backfill source-item links for situations created directly from official events.",
    );
    expect(schema).toContain("s.payload->>'officialSource'");
    expect(schema).toContain("s.payload->>'officialEventId'");
    expect(schema).toContain("WHERE si.kind = 'official_event'");
    expect(schema).toContain("ON CONFLICT (situation_id, source_item_id) DO NOTHING");
    expect(schema).not.toMatch(/INSERT INTO source_items[\s\S]*FROM datex_travel_times/);
    expect(schema).not.toContain("datex_travel_time', 'official_event'");
  });

  it("enforces telemetry/context feeds as non-causal incident context", async () => {
    const schema = await readFile(schemaPath, "utf8");

    for (const provider of [
      "met",
      "nve",
      "datex_travel_time",
      "datex_weather",
      "datex_cctv",
      "trafikkdata",
      "vegvesen_traffic_info",
      "entur_vehicle_positions",
      "entur_service_alerts",
      "bane_nor",
      "dsb",
    ]) {
      expect(schema).toContain(provider);
    }
    expect(schema).toContain("evidence_items_no_telemetry_source_check");
    expect(schema).toContain("evidence_items_no_health_only_source_check");
    expect(schema).toContain("evidence_items_source_id_check");
    expect(schema).toContain("source_items_provider_source_id_check");
    expect(schema).toContain("source_items_no_health_only_provider_check");
    expect(schema).toContain("source_health_source_id_check");
    expect(schema).toContain("source_health_state_check");
    const regionalReportingSources = [
      "snasningen",
      "merakerposten",
      "frostingen",
      "ytringen",
      "steinkjer_avisa",
      "innherred",
      "namdalsavisa",
      "malviknytt",
      "selbyggen",
      "fjell_ljom",
      "retten",
      "hitra_froya",
      "tronderbladet",
      "nidaros",
      "t_a",
    ];
    const sourceHealthConstraint = schema.slice(
      schema.indexOf("ALTER TABLE source_health ADD CONSTRAINT source_health_source_id_check"),
      schema.indexOf(
        "ALTER TABLE source_health DROP CONSTRAINT IF EXISTS source_health_state_check",
      ),
    );
    const evidenceSourceConstraint = schema.slice(
      schema.indexOf("ALTER TABLE evidence_items ADD CONSTRAINT evidence_items_source_id_check"),
      schema.indexOf("CREATE TABLE IF NOT EXISTS timeline_entries"),
    );
    const sourceItemProviderConstraint = schema.slice(
      schema.indexOf(
        "ALTER TABLE source_items ADD CONSTRAINT source_items_provider_source_id_check",
      ),
      schema.indexOf(
        "ALTER TABLE source_items DROP CONSTRAINT IF EXISTS source_items_no_health_only_provider_check",
      ),
    );
    for (const provider of regionalReportingSources) {
      expect(sourceHealthConstraint).toContain(provider);
      expect(evidenceSourceConstraint).toContain(provider);
      expect(sourceItemProviderConstraint).toContain(provider);
    }
    expect(sourceHealthConstraint).toContain("web_push");
    expect(evidenceSourceConstraint).toContain("web_push");
    expect(sourceItemProviderConstraint).toContain("web_push");
    expect(schema).toContain("CHECK (source NOT IN ('dsb','web_push'))");
    expect(schema).toContain("CHECK (provider NOT IN ('dsb','web_push'))");
    expect(schema).toContain("traffic_map_events_source_check");
    expect(schema).toContain("CHECK (source IN ('vegvesen_traffic_info'))");
    expect(schema).toContain("source_items_entur_vehicle_positions_kind_check");
    expect(schema).toContain("source_items_entur_official_event_service_alert_check");
    expect(schema).toContain("situations_official_source_check");
    expect(schema).toContain("situations_confidence_score_check");
    expect(schema).toContain("situations_activation_rule_id_check");
    expect(schema).toContain("'two_independent_reporting_sources'");
    expect(schema).toContain("'official_high_impact_exception'");
    expect(schema).toContain("situations_activation_sources_no_context_source_check");
    expect(schema).toContain("situation_activations_source_ids_no_context_source_check");
    expect(schema).toContain("evidence_items_role_check");
    expect(schema).toContain("evidence_items_input_hash_unique");
    expect(schema).toContain("fill_evidence_item_decision_metadata");
    expect(schema).toContain("evidence_items_decision_metadata_fill");
    expect(schema).toContain(
      "(normalized_payload->>'source') IS NOT DISTINCT FROM 'entur_service_alerts'",
    );
    expect(schema).toContain("Entur official_event source_items must be service alerts");
    expect(schema).toContain("telemetry/context source_items are already linked as supports");
    expect(schema).toContain("'dsb'");
    expect(schema).toContain("OR (source_provider = 'entur' AND source_kind = 'official_event')");
    expect(schema).toContain("enforce_situation_source_item_relationship");
    expect(schema).toContain("relationship = 'supports'");
    expect(schema).toContain("RAISE EXCEPTION");
  });

  it("stores append-only situation decision audit entries outside upstream evidence", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS situation_decision_audit");
    expect(schema).toContain("action text NOT NULL CHECK");
    expect(schema).toContain("source_item_ids text[] NOT NULL DEFAULT ARRAY[]::text[]");
    expect(schema).toContain("evidence_item_ids text[] NOT NULL DEFAULT ARRAY[]::text[]");
    expect(schema).toContain("situation_decision_audit_situation_created_idx");
    expect(schema).toContain("situation_decision_audit_action_created_idx");
    expect(schema).toContain("situation_decision_audit_source_item_ids_gin_idx");
    const auditTable = schema.slice(
      schema.indexOf("CREATE TABLE IF NOT EXISTS situation_decision_audit"),
      schema.indexOf("CREATE INDEX IF NOT EXISTS situation_decision_audit_situation_created_idx"),
    );
    expect(auditTable).not.toContain("raw_payload");
  });

  it("stores worker cycle metrics in an operational table outside source_items", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS worker_cycle_metrics");
    expect(schema).toContain("id text PRIMARY KEY CHECK (id = 'latest')");
    expect(schema).toContain("cycle_duration_ms integer NOT NULL CHECK (cycle_duration_ms >= 0)");
    expect(schema).toContain("payload jsonb NOT NULL");
    expect(schema.indexOf("CREATE TABLE IF NOT EXISTS worker_cycle_metrics")).toBeGreaterThan(
      schema.indexOf("CREATE TABLE IF NOT EXISTS collector_state"),
    );
  });

  it("stores append-only collector run history outside source_items", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS collector_runs");
    expect(schema).toContain("status text NOT NULL CHECK");
    expect(schema).toContain("records_accepted integer NOT NULL DEFAULT 0");
    expect(schema).toContain("diagnostics jsonb");
    expect(schema).toContain("collector_runs_source_started_idx");
    expect(schema).toContain("009_collector_runs");
    expect(schema).not.toMatch(/CREATE TABLE IF NOT EXISTS collector_runs[\s\S]*raw_payload/);
  });

  it("stores derived coverage bundle decisions outside source_items", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS coverage_bundles");
    expect(schema).toContain("member_article_ids text[] NOT NULL");
    expect(schema).toContain("source_labels text[] NOT NULL");
    expect(schema).toContain("signals jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(schema).toContain("near_misses jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(schema).toContain("coverage_bundles_generated_at_idx");
    expect(schema).toContain("coverage_bundles_last_seen_at_idx");
    expect(schema).toContain("coverage_bundles_kind_idx");
    expect(schema).toContain("coverage_bundles_confidence_idx");
    expect(schema).toContain("coverage_bundles_member_article_ids_gin_idx");
    expect(schema).toContain("010_coverage_bundles");
    expect(schema).not.toMatch(/coverage_bundles[\s\S]{0,120}source_items/);
    expect(schema).not.toContain("'coverage_bundles'");
  });

  it("stores generated morning briefs outside source_items", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS morning_briefs");
    expect(schema).toContain("mode text NOT NULL CHECK (mode IN ('ai_assisted', 'deterministic'))");
    expect(schema).toContain("paragraphs jsonb NOT NULL");
    expect(schema).toContain("CHECK (jsonb_array_length(paragraphs) = 3)");
    expect(schema).toContain("morning_briefs_generated_at_idx");
    expect(schema).toContain("013_morning_briefs");
    expect(schema).not.toMatch(/morning_briefs[\s\S]{0,160}source_items/);
  });

  it("stores access requests outside source_items", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS access_requests");
    expect(schema).toContain("email_normalized text NOT NULL");
    expect(schema).toContain("status text NOT NULL DEFAULT 'unverified'");
    expect(schema).toContain("email_verified_at timestamptz");
    expect(schema).toContain("access_requests_email_normalized_unique");
    expect(schema).toContain("access_requests_status_requested_idx");
    expect(schema).toContain("011_access_requests");
    expect(schema).not.toMatch(/access_requests[\s\S]{0,120}source_items/);
  });

  it("stores restricted-beta auth users and tokens outside source_items", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS users");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS user_identities");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS auth_tokens");
    expect(schema).toContain("token_hash text NOT NULL UNIQUE");
    expect(schema).toContain(
      "kind text NOT NULL CHECK (kind IN ('access_verify', 'invite', 'login'))",
    );
    expect(schema).toContain("role text NOT NULL CHECK (role IN ('owner', 'viewer'))");
    expect(schema).toContain("status text NOT NULL DEFAULT 'active' CHECK");
    expect(schema).toContain("UNIQUE (provider, provider_subject)");
    expect(schema).toContain("auth_tokens_kind_expires_idx");
    expect(schema).toContain("012_restricted_beta_auth");
    expect(schema).not.toMatch(/CREATE TABLE IF NOT EXISTS auth_tokens[\s\S]*raw_payload/);
    expect(schema).not.toMatch(/auth_tokens[\s\S]{0,120}source_items/);
    expect(schema).not.toMatch(/user_identities[\s\S]{0,120}source_items/);
  });

  it("stores Web Push subscriptions and deliveries outside source_items", async () => {
    const schema = await readFile(schemaPath, "utf8");

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS push_subscriptions");
    expect(schema).toContain("endpoint_hash text NOT NULL UNIQUE");
    expect(schema).toContain("min_severity text NOT NULL DEFAULT 'warning'");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS push_notification_deliveries");
    expect(schema).toContain("UNIQUE (trigger_id, subscription_id)");
    expect(schema).toContain("push_notification_deliveries_created_idx");
    expect(schema).toContain("014_web_push_notifications");
    expect(schema).not.toMatch(/push_subscriptions[\s\S]{0,160}source_items/);
    expect(schema).not.toMatch(/push_notification_deliveries[\s\S]{0,160}source_items/);
  });
});
