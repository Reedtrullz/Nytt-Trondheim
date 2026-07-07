import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const playbook = readFileSync(new URL("../../../ansible-playbook.yml", import.meta.url), "utf8");
const compose = readFileSync(new URL("../../../docker-compose.yml", import.meta.url), "utf8");

describe("deployment playbook Entur verification", () => {
  it("keeps API and worker compose healthchecks on their own runtime duties", () => {
    const appStart = compose.indexOf("  app:");
    const workerStart = compose.indexOf("  worker:");
    const appBlock = compose.slice(appStart, workerStart);
    const workerBlock = compose.slice(workerStart);

    expect(appBlock).toContain("curl -f http://localhost:8080/health/live");
    expect(appBlock).not.toContain("worker_cycle_metrics");
    expect(workerBlock).toContain("worker_cycle_metrics");
    expect(workerBlock).not.toContain("curl -f http://localhost:8080/health/live");
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

  it("requires DATEX source health rows to be ok without per-source timestamp coupling", () => {
    const taskStart = playbook.indexOf(
      "- name: Verify DATEX source health rows when DATEX is enabled",
    );
    const taskEnd = playbook.indexOf("- name: Verify Entur source health", taskStart);
    const task = playbook.slice(taskStart, taskEnd);

    expect(taskStart).toBeGreaterThan(-1);
    expect(task).toContain("state='ok'");
    expect(task).not.toMatch(/last_checked_at\s*>\s*now\(\)\s*-\s*interval/);
    expect(task).not.toContain("candidate_validation_started_at.stdout");
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
    expect(task).toContain("cycle_completed_at > now() - interval '2 hours'");
    expect(task).toContain("register: promoted_worker_cycle");
    expect(task).toContain("until: promoted_worker_cycle.rc == 0");
    expect(task).not.toContain("candidate_validation_started_at.stdout");
    expect(task).toContain("- name: Verify traffic source health after candidate promotion");
    expect(task).toContain("FROM source_health");
    expect(task).toContain("source IN ('vegvesen_traffic_info','trafikkdata')");
    expect(task).toContain("state='ok'");
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

  it("requires healthy Entur source health rows without deploy-time freshness coupling", () => {
    const taskStart = playbook.indexOf(
      "- name: Verify Entur source health and provenance invariants when tables exist",
    );
    const taskEnd = playbook.indexOf("- name: Verify source item query sanity", taskStart);
    const task = playbook.slice(taskStart, taskEnd);

    expect(taskStart).toBeGreaterThan(-1);
    expect(task).not.toMatch(/last_checked_at\s*>\s*now\(\)\s*-\s*interval/);
    expect(task).not.toContain("candidate_validation_started_at.stdout");
  });
});
