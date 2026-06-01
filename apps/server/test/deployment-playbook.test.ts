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
});
