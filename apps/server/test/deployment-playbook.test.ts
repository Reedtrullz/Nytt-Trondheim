import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const playbook = readFileSync(new URL("../../../ansible-playbook.yml", import.meta.url), "utf8");

describe("deployment playbook Entur verification", () => {
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
    expect(validationBlock).toMatch(/- name: Verify worker/);
    expect(validationBlock).toContain("- name: Verify DATEX source health rows when DATEX is enabled");
    expect(validationBlock).toContain("- name: Verify Entur source health");
    expect(validationBlock).toContain("- name: Verify source item query sanity");

    const alwaysStart = playbook.indexOf("always:", rescueStart);
    const rescueBlock = playbook.slice(rescueStart, alwaysStart > rescueStart ? alwaysStart : undefined);
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
    const deploymentDoc = readFileSync(new URL("../../../docs/DEPLOYMENT.md", import.meta.url), "utf8");
    expect(deploymentDoc).toMatch(/migrations run before canary against the production database/i);
    expect(deploymentDoc).toMatch(/expand\/contract-compatible with the previous release/i);
    expect(deploymentDoc).toMatch(/destructive schema changes must be split into a later deploy/i);
    expect(deploymentDoc).not.toMatch(/failed backup, migration or canary does not leave the site offline/i);
  });
});
