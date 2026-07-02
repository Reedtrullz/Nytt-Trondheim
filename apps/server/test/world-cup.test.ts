import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearWorldCupDashboardCache,
  loadWorldCupDashboard,
  normalizeWorldCupDashboard,
} from "../src/sport/world-cup.js";
import { createApp } from "../src/app.js";

const scoreboardFixture = {
  events: [
    {
      id: "760490",
      date: "2026-06-30T17:00:00.000Z",
      season: { slug: "round-of-32" },
      competitions: [
        {
          date: "2026-06-30T17:00:00.000Z",
          altGameNote: "FIFA World Cup, Round of 32",
          status: {
            type: { state: "post", completed: true, shortDetail: "FT" },
          },
          venue: { fullName: "AT&T Stadium", address: { city: "Arlington, Texas" } },
          competitors: [
            {
              id: "4789",
              homeAway: "home",
              score: "1",
              winner: false,
              team: { id: "4789", displayName: "Ivory Coast", abbreviation: "CIV" },
            },
            {
              id: "464",
              homeAway: "away",
              score: "2",
              winner: true,
              team: { id: "464", displayName: "Norway", abbreviation: "NOR" },
            },
          ],
        },
      ],
    },
    {
      id: "760501",
      date: "2026-07-02T19:00:00.000Z",
      season: { slug: "round-of-32" },
      competitions: [
        {
          date: "2026-07-02T19:00:00.000Z",
          altGameNote: "FIFA World Cup, Round of 32",
          status: {
            type: { state: "in", completed: false, shortDetail: "35'" },
          },
          venue: { fullName: "Lumen Field", address: { city: "Seattle, Washington" } },
          competitors: [
            {
              id: "164",
              homeAway: "home",
              score: "0",
              winner: false,
              team: { id: "164", displayName: "Spain", abbreviation: "ESP" },
            },
            {
              id: "204",
              homeAway: "away",
              score: "0",
              winner: false,
              team: { id: "204", displayName: "Austria", abbreviation: "AUT" },
            },
          ],
        },
      ],
    },
    {
      id: "760509",
      date: "2026-07-05T20:00:00.000Z",
      season: { slug: "round-of-16" },
      competitions: [
        {
          date: "2026-07-05T20:00:00.000Z",
          altGameNote: "FIFA World Cup, Round of 16",
          status: {
            type: { state: "pre", completed: false, shortDetail: "7/5 - 4:00 PM EDT" },
          },
          venue: {
            fullName: "MetLife Stadium",
            address: { city: "East Rutherford, New Jersey" },
          },
          competitors: [
            {
              id: "205",
              homeAway: "home",
              team: { id: "205", displayName: "Brazil", abbreviation: "BRA" },
            },
            {
              id: "464",
              homeAway: "away",
              team: { id: "464", displayName: "Norway", abbreviation: "NOR" },
            },
          ],
        },
      ],
    },
  ],
};

const standingsFixture = {
  children: [
    {
      name: "Group I",
      standings: {
        entries: [
          {
            team: { displayName: "France" },
            note: { description: "Vant gruppa" },
            stats: [
              { name: "gamesPlayed", value: 3 },
              { name: "wins", value: 3 },
              { name: "ties", value: 0 },
              { name: "losses", value: 0 },
              { name: "pointsFor", value: 10 },
              { name: "pointsAgainst", value: 2 },
              { name: "pointDifferential", value: 8 },
              { name: "points", value: 9 },
            ],
          },
          {
            team: { displayName: "Norway" },
            note: { description: "Videre" },
            stats: [
              { name: "gamesPlayed", value: 3 },
              { name: "wins", value: 2 },
              { name: "ties", value: 0 },
              { name: "losses", value: 1 },
              { name: "pointsFor", value: 8 },
              { name: "pointsAgainst", value: 7 },
              { name: "pointDifferential", value: 1 },
              { name: "points", value: 6 },
            ],
          },
        ],
      },
    },
  ],
};

async function testApp() {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "nytt-world-cup-"));
  return createApp({
    port: 0,
    nodeEnv: "development",
    publicOrigin: "http://localhost",
    seedDemo: true,
    devAuthBypass: true,
    githubAllowedLogin: "Reedtrullz",
    sessionSecret: "test-only-secret",
    uploadDir,
    runtimeStatusDir: uploadDir,
    rateLimitEnabled: true,
  });
}

describe("World Cup dashboard", () => {
  afterEach(() => {
    clearWorldCupDashboardCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes ESPN matches, standings and Norway path into a public dashboard payload", () => {
    const payload = normalizeWorldCupDashboard(
      scoreboardFixture,
      standingsFixture,
      new Date("2026-07-02T18:50:00.000Z"),
    );

    expect(payload.sourceMode).toBe("live");
    expect(payload.nextRefreshSeconds).toBe(75);
    expect(payload.sourceDetail).not.toContain("competitors");
    expect(payload.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "760490",
          stage: "32-delsfinale",
          home: "Elfenbenskysten",
          away: "Norge",
          result: "1-2",
          norwayFocus: true,
          featured: true,
        }),
        expect.objectContaining({
          id: "760501",
          home: "Spania",
          away: "Østerrike",
          status: "live",
        }),
        expect.objectContaining({
          id: "760509",
          stage: "Åttedelsfinale",
          home: "Brasil",
          away: "Norge",
          status: "upcoming",
        }),
      ]),
    );
    expect(payload.norwayPath.map((step) => step.label)).toEqual([
      "Forrige",
      "Neste",
      "Mulig etterpå",
    ]);
    expect(payload.groups[0]).toMatchObject({
      title: "Gruppe I",
      reason: "Norge-gruppa",
      rows: expect.arrayContaining([expect.objectContaining({ team: "Norge", points: 6 })]),
    });
  });

  it("returns the curated fallback when the live feed cannot be fetched", async () => {
    clearWorldCupDashboardCache();
    const fetchMock = vi.fn().mockRejectedValue(new Error("network timeout"));

    const payload = await loadWorldCupDashboard(
      fetchMock as unknown as typeof fetch,
      new Date("2026-07-02T18:50:00.000Z"),
    );

    expect(payload.sourceMode).toBe("fallback");
    expect(payload.sourceLabel).toBe("Kuratert VM-snapshot");
    expect(payload.sourceDetail).toContain("network timeout");
    expect(payload.matches.length).toBeGreaterThan(0);
  });

  it("serves the normalized dashboard through the authenticated API route", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => scoreboardFixture,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => standingsFixture,
      });
    vi.stubGlobal("fetch", fetchMock);
    const { app } = await testApp();

    const response = await request(app).get("/api/sport/world-cup").expect(200);

    expect(response.headers["cache-control"]).toBe("private, max-age=60");
    expect(response.body).toMatchObject({
      sourceMode: "live",
      sourceLabel: "ESPN livefeed",
    });
    expect(response.body.matches).toEqual(
      expect.arrayContaining([expect.objectContaining({ home: "Brasil", away: "Norge" })]),
    );
    expect(response.body).not.toHaveProperty("events");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
