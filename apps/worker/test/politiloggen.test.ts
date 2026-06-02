import { describe, expect, it } from "vitest";
import {
  collectPolitiloggen,
  politiloggenSituationsFromThreads,
  type PolitiloggenThread,
} from "../src/politiloggen.js";
import type { Situation } from "@nytt/shared";

const activeThread: PolitiloggenThread = {
  id: "265vq7",
  district: "Trøndelag Politidistrikt",
  districtId: 209,
  category: "Trafikk",
  municipality: "Trondheim",
  area: "Kroppan Bru",
  createdOn: "2026-05-29T14:48:31.5549179+00:00",
  updatedOn: "2026-05-29T15:20:22.7975932+00:00",
  lastMessageOn: "2026-05-29T15:20:20.738679+00:00",
  isActive: true,
  messages: [
    {
      id: "265vq7-0",
      text: "En bil har fått stans i nordgående løp på Kroppan bru.",
      createdOn: "2026-05-29T14:48:31.5544696+00:00",
      updatedOn: "2026-05-29T14:48:31.6146861+00:00",
      hasImage: false,
      previouslyIncludedImage: false,
      type: "Published",
    },
    {
      id: "265vq7-1",
      text: "Bilen er nå hentet og trafikken går som normalt igjen.",
      createdOn: "2026-05-29T15:20:20.738679+00:00",
      updatedOn: "2026-05-29T15:20:20.738679+00:00",
      hasImage: false,
      previouslyIncludedImage: false,
      type: "Published",
    },
  ],
};

describe("Politiloggen ingestion", () => {
  it("fetches Trondheim threads from the documented API and normalizes them to articles", async () => {
    let requestedUrl: URL | undefined;
    let userAgent: string | null = null;

    const result = await collectPolitiloggen(async (url, init) => {
      requestedUrl = new URL(String(url));
      userAgent = new Headers(init?.headers).get("User-Agent");
      return new Response(JSON.stringify({ messageThreads: [activeThread], count: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    expect(requestedUrl?.origin).toBe("https://api.politiloggen.politiet.no");
    expect(requestedUrl?.pathname).toBe("/messagethreads");
    expect(requestedUrl?.searchParams.get("Municipalities")).toBe("Trondheim");
    expect(requestedUrl?.searchParams.get("Take")).toBe("1000");
    expect(userAgent).toContain("NyttTrondheim");
    expect(result.threads).toEqual([activeThread]);
    expect(result.articles[0]).toMatchObject({
      id: "politiloggen-265vq7",
      source: "politiloggen",
      sourceLabel: "Politiloggen",
      title: "Trafikk: Trondheim, Kroppan Bru",
      excerpt:
        "En bil har fått stans i nordgående løp på Kroppan bru.\nBilen er nå hentet og trafikken går som normalt igjen.",
      url: "https://www.politiet.no/politiloggen/hendelse/265vq7",
      publishedAt: "2026-05-29T14:48:31.554Z",
      scope: "trondheim",
      category: "Transport",
      places: ["Kroppan Bru", "Trondheim"],
    });
  });

  it("does not expose inactive Politiloggen threads as activation articles", async () => {
    const inactiveThread = { ...activeThread, isActive: false };

    const result = await collectPolitiloggen(
      async () =>
        new Response(JSON.stringify({ messageThreads: [inactiveThread], count: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    expect(result.threads).toEqual([inactiveThread]);
    expect(result.articles).toEqual([]);
  });

  it("promotes active Politiloggen threads to official situations", () => {
    const situations = politiloggenSituationsFromThreads([activeThread]);

    expect(situations).toHaveLength(1);
    expect(situations[0]).toMatchObject({
      id: "politiloggen-265vq7",
      type: "traffic",
      title: "Trafikk: Trondheim, Kroppan Bru",
      status: "active",
      verificationStatus: "Offentlig bekreftet",
      updatedAt: "2026-05-29T15:20:20.738Z",
      createdAt: "2026-05-29T14:48:31.554Z",
      locationLabel: "Kroppan Bru",
      incidentSignature: "politiloggen:265vq7",
      officialSource: "politiloggen",
      officialEventId: "265vq7",
      relatedArticleIds: ["politiloggen-265vq7"],
    });
    expect(situations[0]?.timeline.map((entry) => entry.title)).toEqual([
      "Politiloggen: Trafikk",
      "Politiloggen: Trafikk",
    ]);
    expect(situations[0]?.evidence[0]).toMatchObject({
      source: "politiloggen",
      provenance: "official",
      claimType: "official_police_log",
      confidence: 1,
    });
  });

  it("resolves an existing Politiloggen situation when the thread is inactive", () => {
    const existing = politiloggenSituationsFromThreads([activeThread])[0] as Situation;
    const inactiveThread = { ...activeThread, isActive: false };

    const situations = politiloggenSituationsFromThreads([inactiveThread], [existing]);

    expect(situations[0]?.status).toBe("resolved");
    expect(situations[0]?.timeline.at(-1)).toMatchObject({
      title: "Politiloggen-hendelsen er avsluttet",
      official: true,
    });
  });

  it("expires or de-emphasizes inactive Politiloggen events", () => {
    const inactiveThread = { ...activeThread, isActive: false };

    expect(politiloggenSituationsFromThreads([inactiveThread])).toEqual([]);

    const existing = politiloggenSituationsFromThreads([activeThread])[0] as Situation;
    const [resolved] = politiloggenSituationsFromThreads([inactiveThread], [existing]);

    expect(resolved).toMatchObject({
      id: existing.id,
      status: "resolved",
      incidentSignature: "politiloggen:265vq7",
      officialSource: "politiloggen",
      officialEventId: "265vq7",
    });
    expect(resolved?.activationBasis).toEqual(existing.activationBasis);
    expect(resolved?.timeline.at(-1)).toMatchObject({
      title: "Politiloggen-hendelsen er avsluttet",
      detail: "Politiloggen markerer ikke lenger hendelsen som aktiv.",
      official: true,
    });
  });
});
