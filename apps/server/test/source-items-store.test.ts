import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { MemoryStore, PgStore } from "../src/store.js";

const sourceItemRow = (overrides: Record<string, unknown> = {}) => ({
  id: "source:one",
  provider: "nrk",
  kind: "article",
  external_id: "article-one",
  original_url: "https://example.test/one",
  title: "Brann i Bymarka",
  summary: "Røyk observert.",
  author: null,
  published_at: new Date("2026-05-28T10:00:00.000Z"),
  fetched_at: new Date("2026-05-28T10:01:00.123Z"),
  fetched_at_cursor: "2026-05-28T10:01:00.123000Z",
  capture_hash: "a".repeat(64),
  geo_hint: { type: "Point", coordinates: [10.3, 63.4] },
  reliability_tier: "trusted_media",
  linked_situation_ids: [],
  ...overrides,
});

const pgSourceItemRow = sourceItemRow;

const decodeCursor = (cursor: string) =>
  JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [string, string];

describe("source item store", () => {
  it("lists seeded MemoryStore source items with unlinked filtering", async () => {
    const store = new MemoryStore();

    const page = await store.listSourceItems({ unlinked: true, limit: 5 });

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0]).toMatchObject({ kind: "article", reliabilityTier: expect.any(String) });
    expect(page.items[0]?.linkedSituationIds).toEqual([]);
  });

  it("queries PgStore source items by fetched_at desc cursor order", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [sourceItemRow()] });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listSourceItems({ provider: "nrk", kind: "article", q: "Brann", limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: "source:one", externalId: "article-one" });
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("FROM source_items si");
    expect(sql).toContain("ST_AsGeoJSON(si.geo_hint)::json AS geo_hint");
    expect(sql).toContain("ORDER BY si.fetched_at DESC, si.id DESC");
    expect(sql).toContain("LIMIT");
    expect(sql).toContain("si.provider =");
    expect(sql).toContain("si.kind =");
    expect(sql).toContain("ILIKE");
    expect(sql).toContain("fetched_at_cursor");
  });

  it("adds an unlinked NOT EXISTS filter to PgStore source item queries", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new PgStore({ query } as unknown as pg.Pool);

    await store.listSourceItems({ unlinked: true });

    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain(
      "NOT EXISTS (SELECT 1 FROM situation_source_items unlinked_ssi WHERE unlinked_ssi.source_item_id = si.id)",
    );
  });

  it("does not expose raw or normalized payload fields on returned PgStore source items", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        sourceItemRow({
          raw_payload: { internal: true },
          normalized_payload: { internal: true },
        }),
      ],
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listSourceItems({ limit: 1 });

    expect(page.items[0]).not.toHaveProperty("rawPayload");
    expect(page.items[0]).not.toHaveProperty("normalizedPayload");
  });

  it("uses the visible row's exact microsecond fetched_at_cursor for PgStore pagination", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        sourceItemRow({
          id: "source:visible",
          fetched_at: new Date("2026-05-28T10:01:00.123Z"),
          fetched_at_cursor: "2026-05-28T10:01:00.123456Z",
        }),
        sourceItemRow({
          id: "source:overflow",
          external_id: "article-overflow",
          fetched_at: new Date("2026-05-28T10:00:00.999Z"),
          fetched_at_cursor: "2026-05-28T10:00:00.999999Z",
        }),
      ],
    });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const page = await store.listSourceItems({ limit: 1 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.fetchedAt).toBe("2026-05-28T10:01:00.123Z");
    expect(page.nextCursor).toBeDefined();
    expect(decodeCursor(page.nextCursor!)).toEqual([
      "2026-05-28T10:01:00.123456Z",
      "source:visible",
    ]);
  });

  it("links and unlinks source items in MemoryStore", async () => {
    const store = new MemoryStore();
    const [item] = (await store.listSourceItems({ limit: 1 }, "Reedtrullz")).items;
    expect(item).toBeTruthy();

    const linked = await store.linkSourceItem(
      "skogbrann-bymarka",
      item.id,
      "supports",
      "Reedtrullz",
    );
    expect(linked?.linkedSituationIds).toContain("skogbrann-bymarka");

    const situationItems = await store.listSituationSourceItems("skogbrann-bymarka", "Reedtrullz");
    expect(situationItems.map((source) => source.id)).toContain(item.id);

    await expect(
      store.unlinkSourceItem("skogbrann-bymarka", item.id, "Reedtrullz"),
    ).resolves.toBe(true);
    await expect(store.listSituationSourceItems("skogbrann-bymarka", "Reedtrullz")).resolves.toEqual([]);
  });

  it("uses idempotent PgStore SQL for source item links", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: "source:one" }] })
      .mockResolvedValueOnce({ rows: [pgSourceItemRow({ linked_situation_ids: ["skogbrann-bymarka"] })] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const store = new PgStore({ query } as unknown as pg.Pool);

    const linked = await store.linkSourceItem("skogbrann-bymarka", "source:one", "supports", "Reedtrullz");
    expect(linked?.linkedSituationIds).toEqual(["skogbrann-bymarka"]);
    expect(query.mock.calls[0]?.[0]).toContain("INSERT INTO situation_source_items");
    expect(query.mock.calls[0]?.[0]).toContain("ON CONFLICT");

    await expect(store.unlinkSourceItem("skogbrann-bymarka", "source:one", "Reedtrullz")).resolves.toBe(true);
    expect(query.mock.calls[2]?.[0]).toContain("DELETE FROM situation_source_items");
  });

  it("returns undefined when PgStore cannot link missing source items or situations", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const store = new PgStore({ query } as unknown as pg.Pool);

    await expect(
      store.linkSourceItem("missing-situation", "missing-source", "supports", "Reedtrullz"),
    ).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(1);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("WHERE EXISTS (SELECT 1 FROM situations");
    expect(sql).toContain("EXISTS (SELECT 1 FROM source_items");
  });
});
