import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const playbook = readFileSync(new URL("../../../ansible-playbook.yml", import.meta.url), "utf8");
const compose = readFileSync(new URL("../../../docker-compose.yml", import.meta.url), "utf8");
const ciWorkflow = readFileSync(
  new URL("../../../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const deployWorkflow = readFileSync(
  new URL("../../../.github/workflows/deploy.yml", import.meta.url),
  "utf8",
);
const promotionSqlUrl = new URL(
  "../../../scripts/promote-coverage-generation.sql",
  import.meta.url,
);
const promotionSql = existsSync(promotionSqlUrl) ? readFileSync(promotionSqlUrl, "utf8") : "";
const promotionControlSql = readFileSync(
  new URL("../../../scripts/coverage-promotion-control-flow.sql", import.meta.url),
  "utf8",
);
const lifecycleSmoke = readFileSync(
  new URL("../../../scripts/coverage-lifecycle-smoke.ts", import.meta.url),
  "utf8",
);

describe("deployment playbook Entur verification", () => {
  it("plumbs safe server and worker coverage rollout defaults without exposing them to Vite", () => {
    const appStart = compose.indexOf("  app:");
    const workerStart = compose.indexOf("  worker:");
    const appBlock = compose.slice(appStart, workerStart);
    const workerBlock = compose.slice(workerStart);

    expect(appBlock).toContain("COVERAGE_PROJECTION_MODE: ${COVERAGE_PROJECTION_MODE:-legacy}");
    expect(appBlock).toContain(
      "COVERAGE_CORRECTIONS_ENABLED: ${COVERAGE_CORRECTIONS_ENABLED:-false}",
    );
    expect(appBlock).not.toContain("COVERAGE_MATCHER_VERSION");
    expect(workerBlock).toContain("COVERAGE_MATCHER_VERSION: ${COVERAGE_MATCHER_VERSION:-v1}");
    expect(workerBlock).toContain("COVERAGE_GENERATION_MODE: ${COVERAGE_GENERATION_MODE:-shadow}");
    expect(compose).not.toContain("VITE_COVERAGE_");
  });

  it("requires exact reviewed promotion when the current active v2 generation is not healthy", () => {
    const promotionContract = `${playbook}\n${promotionSql}`;
    expect(deployWorkflow).toContain("COVERAGE_V2_OWNER_REVIEWED_GENERATION_ID");
    expect(playbook).toContain("coverage_v2_promotion_required");
    expect(playbook).toContain("coverage_v2_owner_reviewed_generation_id");
    expect(playbook).toContain("health_outcome='healthy'");
    expect(promotionContract).toContain("matcher_version='v2'");
    expect(promotionContract).toContain("mode='shadow'");
    expect(promotionContract).toContain("status='completed'");
    expect(promotionContract).toContain("min(completed_at) > now() - interval '24 hours'");
    expect(promotionContract).toContain("FOR UPDATE");
    expect(promotionContract).toContain("promoted_count");
    expect(promotionContract).toContain("pg_advisory_xact_lock(20260713, 7)");
    expect(promotionContract).toContain("GET DIAGNOSTICS promoted_count = ROW_COUNT");
    expect(promotionContract).toContain("GET DIAGNOSTICS activated_bundle_count = ROW_COUNT");
    expect(promotionContract).toContain("RAISE EXCEPTION");
    expect(promotionContract).toContain("legacy_generation_id=reviewed_generation_id");
    expect(promotionContract).not.toContain('test "$promoted_count" -eq 1');
    expect(promotionSql.indexOf("GET DIAGNOSTICS promoted_count = ROW_COUNT")).toBeLessThan(
      promotionSql.indexOf("SET is_current=false"),
    );
    expect(promotionSql.indexOf("GET DIAGNOSTICS activated_bundle_count = ROW_COUNT")).toBeLessThan(
      promotionSql.indexOf("SET is_current=false"),
    );
    expect(promotionSql).toContain("VALUES (:'reviewed_generation_id'::uuid)");
    expect(playbook).toContain("when: coverage_v2_promotion_required | bool");
    expect(playbook).toContain("scripts/promote-coverage-generation.sql");
  });

  it("keeps executable promotion control proof aligned with the production SQL", () => {
    expect(existsSync(promotionSqlUrl)).toBe(true);
    const markers = [
      "pg_advisory_xact_lock(20260713, 7)",
      "matcher_version='v2'",
      "mode='shadow'",
      "status='completed'",
      "legacy_generation_id=reviewed_generation_id",
      "health_outcome",
      "parity_dirty",
      "integrity_dirty",
      "GET DIAGNOSTICS promoted_count = ROW_COUNT",
      "GET DIAGNOSTICS activated_bundle_count = ROW_COUNT",
      "SET is_current=false",
      "SET is_current=true",
      "SET state='active'",
      "SET state='superseded'",
    ];
    for (const marker of markers) {
      expect(promotionSql).toContain(marker);
      expect(promotionControlSql).toContain(marker);
    }
    expect(promotionSql).toContain("bool_and(health_outcome = 'healthy')");
    expect(promotionControlSql).toContain("bool_and(health_outcome='healthy')");
    expect(promotionControlSql).toContain("stable bundle activation mismatch");
    expect(promotionControlSql).toContain("unchecked active v2 generation bypassed promotion");
    expect(promotionControlSql).toContain("promoted generation is not the only healthy current v2");
  });

  it("uses one checked-out PostgreSQL client for the lifecycle promotion transaction", () => {
    expect(lifecycleSmoke).toContain("const promotionClient = await pool.connect()");
    expect(lifecycleSmoke).toContain('await promotionClient.query("BEGIN")');
    expect(lifecycleSmoke).toContain("promotionClient.release()");
    expect(lifecycleSmoke).not.toContain('await pool.query("BEGIN")');
  });

  it("rolls projection flags back without deleting coverage generations or corrections", () => {
    const rescueStart = playbook.indexOf("rescue:");
    const rescueBlock = playbook.slice(rescueStart);
    expect(rescueBlock).toContain("COVERAGE_PROJECTION_MODE=legacy");
    expect(rescueBlock).toContain("COVERAGE_CORRECTIONS_ENABLED=false");
    expect(rescueBlock).toContain("COVERAGE_GENERATION_MODE=shadow");
    expect(rescueBlock).not.toMatch(/DELETE FROM coverage_bundle_(?:generations|corrections)/);
  });

  it("keeps exact matcher, test, build, browser and PostgreSQL lifecycle gates in CI", () => {
    expect(ciWorkflow).toContain("run: npm run check:coverage-matcher");
    expect(ciWorkflow).toContain("run: npm test");
    expect(ciWorkflow).toContain("run: npm run build");
    expect(ciWorkflow).toContain("run: npm run test:e2e");
    expect(ciWorkflow).toContain("Run normalized coverage lifecycle smoke");
    expect(ciWorkflow).toContain("coverage-lifecycle-smoke.ts");
    expect(ciWorkflow).toContain("Run coverage promotion control-flow smoke");
    expect(ciWorkflow).toContain("coverage-promotion-control-flow.sql");
    expect(ciWorkflow.match(/npm run db:migrate/g)).toHaveLength(2);
    expect(ciWorkflow).toContain("docker build --target api");
    expect(ciWorkflow).toContain("docker build --target worker");
  });

  it("keeps API and worker compose healthchecks on their own runtime duties", () => {
    const appStart = compose.indexOf("  app:");
    const workerStart = compose.indexOf("  worker:");
    const appBlock = compose.slice(appStart, workerStart);
    const workerBlock = compose.slice(workerStart);

    expect(appBlock).toContain("curl -f http://localhost:8080/health/live");
    expect(appBlock).not.toContain("/health/ready");
    expect(appBlock).not.toContain("worker_cycle_metrics");
    expect(workerBlock).toContain("worker_cycle_metrics");
    expect(workerBlock).not.toContain("curl -f http://localhost:8080/health");
  });

  it("uses readiness checks for canary, production and rollback validation", () => {
    expect(playbook).toContain('url: "http://127.0.0.1:{{ canary_port }}/health/ready"');
    expect(playbook).toContain('url: "https://nytt.reidar.tech/health/ready"');
    expect(playbook).not.toContain('url: "https://nytt.reidar.tech/health"');
  });

  it("waits for healthy Entur source rows instead of passing on degraded placeholders", () => {
    const taskStart = playbook.indexOf(
      "- name: Verify Entur source health and provenance invariants when tables exist",
    );
    const taskEnd = playbook.indexOf("- name: Verify source item query sanity", taskStart);
    const task = playbook.slice(taskStart, taskEnd);

    expect(task).toContain("state='ok'");
    expect(task).toContain("register: entur_verification");
    expect(task).toContain("until: entur_verification.rc == 0");
    expect(task).toMatch(/retries:\s*\d+/);
    expect(task).toMatch(/delay:\s*\d+/);
  });

  it("rolls back previous app and worker images when post-promotion validation fails", () => {
    const blockStart = playbook.indexOf("- name: Promote candidate and validate production");
    expect(blockStart).toBeGreaterThan(-1);
    const rescueStart = playbook.indexOf("rescue:", blockStart);
    expect(rescueStart).toBeGreaterThan(blockStart);

    const validationBlock = playbook.slice(blockStart, rescueStart);
    const timestampCapture = validationBlock.indexOf(
      "- name: Capture candidate promotion timestamp",
    );
    const promotion = validationBlock.indexOf("- name: Promote API and worker");
    expect(timestampCapture).toBeGreaterThan(-1);
    expect(timestampCapture).toBeLessThan(promotion);
    expect(validationBlock).toContain("- name: Promote API and worker");
    expect(validationBlock).toContain("- name: Verify production health");
    expect(validationBlock).toContain("- name: Capture promoted worker startup state");
    expect(validationBlock).toContain(
      "- name: Verify promoted worker remains stable after startup",
    );
    expect(validationBlock).toContain("- name: Verify worker has a recent completed cycle");
    expect(validationBlock).toContain(
      "- name: Verify DATEX source health rows when DATEX is enabled",
    );
    expect(validationBlock).toContain("- name: Verify Entur source health");
    expect(validationBlock).toContain("- name: Verify source item query sanity");

    const alwaysStart = playbook.indexOf("always:", rescueStart);
    const rescueBlock = playbook.slice(
      rescueStart,
      alwaysStart > rescueStart ? alwaysStart : undefined,
    );
    expect(rescueBlock).toContain("nytt-trondheim-api:previous");
    expect(rescueBlock).toContain("nytt-trondheim-api:latest");
    expect(rescueBlock).toContain("nytt-trondheim-worker:previous");
    expect(rescueBlock).toContain("nytt-trondheim-worker:latest");
    expect(rescueBlock).toContain("docker compose --env-file .env.production up -d app worker");
  });

  it("documents that migrations before canary must be expand-contract compatible", () => {
    expect(playbook).toContain("Create and verify encrypted pre-migration backup");
    const migrationStart = playbook.indexOf("- name: Apply database migrations");
    const canaryStart = playbook.indexOf("- name: Start API canary with production database");
    expect(migrationStart).toBeGreaterThan(-1);
    expect(canaryStart).toBeGreaterThan(-1);
    expect(migrationStart).toBeLessThan(canaryStart);
    const deploymentDoc = readFileSync(
      new URL("../../../docs/DEPLOYMENT.md", import.meta.url),
      "utf8",
    );
    expect(deploymentDoc).toMatch(/migrations run before canary against the production database/i);
    expect(deploymentDoc).toMatch(/expand\/contract-compatible with the previous release/i);
    expect(deploymentDoc).toMatch(/destructive schema changes must be split into a later deploy/i);
    expect(deploymentDoc).not.toMatch(
      /failed backup, migration or canary does not leave the site offline/i,
    );
  });

  it("polls the encrypted backup and restore check instead of holding one long SSH session", () => {
    const taskStart = playbook.indexOf("- name: Create and verify encrypted pre-migration backup");
    const taskEnd = playbook.indexOf("- name: Apply database migrations", taskStart);
    const task = playbook.slice(taskStart, taskEnd);

    expect(taskStart).toBeGreaterThan(-1);
    expect(task).toContain("/usr/local/bin/nytt-backup");
    expect(task).toContain("/usr/local/bin/nytt-restore-check");
    expect(task).toMatch(/async:\s*1800/);
    expect(task).toMatch(/poll:\s*15/);
  });

  it("requires DATEX source health rows to come from the promoted candidate window", () => {
    const taskStart = playbook.indexOf(
      "- name: Verify DATEX source health rows when DATEX is enabled",
    );
    const taskEnd = playbook.indexOf("- name: Verify Entur source health", taskStart);
    const task = playbook.slice(taskStart, taskEnd);

    expect(taskStart).toBeGreaterThan(-1);
    expect(task).toContain("state='ok'");
    expect(task).toContain("last_checked_at >= :'candidate_promotion_started_at'::timestamptz");
    expect(task).toContain("-v candidate_promotion_started_at=");
    expect(task).toContain("<<'SQL'");
    expect(task).not.toContain("-Atqc");
    expect(task).toContain("until:");
    expect(task).toMatch(/retries:\s*\d+/);
  });

  it("verifies promoted worker stability and recent cycle health", () => {
    const workerTaskStart = playbook.indexOf("- name: Capture promoted worker startup state");
    const workerTaskEnd = playbook.indexOf("- name: Verify DATEX source health", workerTaskStart);
    const task = playbook.slice(workerTaskStart, workerTaskEnd);

    expect(workerTaskStart).toBeGreaterThan(-1);
    expect(task).toContain("- name: Capture promoted worker startup state");
    expect(task).toContain("- name: Verify promoted worker remains stable after startup");
    expect(task).toContain("docker inspect -f '{% raw %}{{.RestartCount}}{% endraw %}'");
    expect(task).toContain("worker health is $health");
    expect(task).toContain("- name: Verify worker has a recent completed cycle");
    expect(task).toContain("FROM worker_cycle_metrics");
    expect(task).toContain("cycle_started_at >= :'candidate_promotion_started_at'::timestamptz");
    expect(task).toContain("cycle_completed_at >= :'candidate_promotion_started_at'::timestamptz");
    expect(task).toContain("register: promoted_worker_cycle");
    expect(task).toContain("until: promoted_worker_cycle.rc == 0");
    expect(task).toContain("candidate_promotion_started_at.stdout");
    expect(task).toContain("- name: Verify traffic source health after candidate promotion");
    expect(task).toContain("FROM source_health");
    expect(task).toContain("source IN ('vegvesen_traffic_info','trafikkdata')");
    expect(task).toContain("state='ok'");
    expect(task).toContain("last_checked_at >= :'candidate_promotion_started_at'::timestamptz");
    expect(task).toContain("<<'SQL'");
    expect(task).toContain('test "$count" -eq 2');
    expect(task).not.toMatch(/last_checked_at\s*>\s*now\(\)\s*-\s*interval/);
    expect(task).toContain("register: traffic_source_health");
    expect(task).toContain("until: traffic_source_health.rc == 0");
  });

  it("uses guarded JSON access for production and rollback health checks", () => {
    expect(playbook).toContain("- (production_health.json | default({})).get('status') == \"ok\"");
    expect(playbook).toContain(
      "- (production_health.json | default({})).get('storage') == \"postgres\"",
    );
    expect(playbook).toContain("- (rollback_health.json | default({})).get('status') == \"ok\"");
    expect(playbook).toContain(
      "- (rollback_health.json | default({})).get('storage') == \"postgres\"",
    );
    expect(playbook).toContain(
      "- (canary_health.json | default({})).get('storage') == \"postgres\"",
    );
  });

  it("requires healthy Entur source rows from the promoted candidate window", () => {
    const taskStart = playbook.indexOf(
      "- name: Verify Entur source health and provenance invariants when tables exist",
    );
    const taskEnd = playbook.indexOf("- name: Verify source item query sanity", taskStart);
    const task = playbook.slice(taskStart, taskEnd);

    expect(taskStart).toBeGreaterThan(-1);
    expect(task).toContain("last_checked_at >= :'candidate_promotion_started_at'::timestamptz");
    expect(task).toContain("-v candidate_promotion_started_at=");
    expect(task).toContain("<<'SQL'");
    expect(task).not.toContain("-Atqc");
  });
});
