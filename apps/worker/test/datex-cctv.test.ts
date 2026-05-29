import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { RoadCamera } from "@nytt/shared";
import {
  defaultDatexCctvSitesEndpoint,
  defaultDatexCctvStatusEndpoint,
  parseDatexCctv,
} from "../src/datexCctv.js";

const sitesFixturePath = new URL("./fixtures/datex-cctv-sites.xml", import.meta.url);
const statusFixturePath = new URL("./fixtures/datex-cctv-status.xml", import.meta.url);

const _roadCameraTypeCheck = {
  id: "datex-cctv:CCTV_1",
  source: "datex_cctv",
  cameraId: "CCTV_1",
  name: "Kroppanbrua",
  status: "ok",
  updatedAt: "2026-05-29T11:45:00.000Z",
  geometry: { type: "Point", coordinates: [10.3845, 63.3918] },
  imageUrl: "https://webkamera.vegvesen.no/public/kroppanbrua.jpg",
} satisfies RoadCamera;

void _roadCameraTypeCheck;

async function parseFixtureCameras(): Promise<RoadCamera[]> {
  const [siteXml, statusXml] = await Promise.all([
    readFile(sitesFixturePath, "utf8"),
    readFile(statusFixturePath, "utf8"),
  ]);

  return parseDatexCctv(siteXml, statusXml, {
    receivedAt: "2026-05-29T11:45:00.000Z",
  });
}

describe("DATEX CCTV parsing", () => {
  it("uses the planned Vegvesen CCTV snapshot endpoints by default", () => {
    expect(defaultDatexCctvSitesEndpoint).toBe(
      "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetCCTVSiteTable/pullsnapshotdata",
    );
    expect(defaultDatexCctvStatusEndpoint).toBe(
      "https://datex-server-get-v3-1.atlas.vegvesen.no/datexapi/GetCCTVStatus/pullsnapshotdata",
    );
  });

  it("normalizes Trondheim camera metadata, status, and still-image URL", async () => {
    const cameras = await parseFixtureCameras();

    expect(cameras[0]).toMatchObject({
      id: "datex-cctv:CCTV_1",
      source: "datex_cctv",
      cameraId: "CCTV_1",
      name: "Kroppanbrua",
      status: "ok",
      updatedAt: "2026-05-29T11:45:00.000Z",
      geometry: { type: "Point", coordinates: [10.3845, 63.3918] },
      imageUrl: expect.stringContaining("http"),
    });
  });

  it("skips cameras outside Trøndelag/Trondheim bounds", async () => {
    const cameras = await parseFixtureCameras();

    expect(cameras.map((camera) => camera.cameraId)).not.toContain("CCTV_OSLO");
  });

  it("skips cameras with malformed or missing geometry", async () => {
    const cameras = await parseFixtureCameras();

    expect(cameras.map((camera) => camera.cameraId)).not.toContain("CCTV_BAD_GEOMETRY");
  });

  it("includes local cameras without a matching status as unknown", async () => {
    const cameras = await parseFixtureCameras();

    expect(cameras).toContainEqual(
      expect.objectContaining({
        id: "datex-cctv:CCTV_NO_STATUS",
        cameraId: "CCTV_NO_STATUS",
        name: "Sluppen uten status",
        status: "unknown",
        geometry: { type: "Point", coordinates: [10.395, 63.403] },
      }),
    );
  });

  it("maps offline status variants and ignores non-http image URLs", () => {
    const siteXml = `
      <d2:d2LogicalModel xmlns:d2="http://datex2.eu/schema/3/common">
        <d2:payloadPublication>
          <d2:cctvCameraRecord id="CCTV_OFFLINE">
            <d2:cctvCameraName><d2:values><d2:value>Okstad</d2:value></d2:values></d2:cctvCameraName>
            <d2:coordinatesForDisplay><d2:latitude>63.3600</d2:latitude><d2:longitude>10.3600</d2:longitude></d2:coordinatesForDisplay>
          </d2:cctvCameraRecord>
        </d2:payloadPublication>
      </d2:d2LogicalModel>
    `;
    const statusXml = `
      <d2:d2LogicalModel xmlns:d2="http://datex2.eu/schema/3/common">
        <d2:payloadPublication>
          <d2:cctvCameraStatus>
            <d2:cctvCameraReference id="CCTV_OFFLINE" />
            <d2:availabilityStatus>disabled</d2:availabilityStatus>
            <d2:stillImageUrl>ftp://example.test/not-public.jpg</d2:stillImageUrl>
          </d2:cctvCameraStatus>
        </d2:payloadPublication>
      </d2:d2LogicalModel>
    `;

    expect(
      parseDatexCctv(siteXml, statusXml, {
        receivedAt: "2026-05-29T11:45:00.000Z",
      }),
    ).toEqual([expect.not.objectContaining({ imageUrl: expect.any(String) })]);
    expect(
      parseDatexCctv(siteXml, statusXml, {
        receivedAt: "2026-05-29T11:45:00.000Z",
      })[0],
    ).toMatchObject({ status: "offline" });
  });

  it("keeps valid status and image when followed by a reference-only record", () => {
    const siteXml = `
      <d2:d2LogicalModel xmlns:d2="http://datex2.eu/schema/3/common">
        <d2:payloadPublication>
          <d2:cctvCameraRecord id="CCTV_STATUS_MERGE">
            <d2:cctvCameraName><d2:values><d2:value>Elgeseter bru</d2:value></d2:values></d2:cctvCameraName>
            <d2:coordinatesForDisplay><d2:latitude>63.4160</d2:latitude><d2:longitude>10.3950</d2:longitude></d2:coordinatesForDisplay>
          </d2:cctvCameraRecord>
        </d2:payloadPublication>
      </d2:d2LogicalModel>
    `;
    const statusXml = `
      <d2:d2LogicalModel xmlns:d2="http://datex2.eu/schema/3/common">
        <d2:payloadPublication>
          <d2:cctvCameraStatus>
            <d2:cctvCameraReference id="CCTV_STATUS_MERGE" />
            <d2:operationalStatus>operational</d2:operationalStatus>
            <d2:stillImageUrl>https://webkamera.vegvesen.no/public/status-merge.jpg</d2:stillImageUrl>
          </d2:cctvCameraStatus>
          <d2:metadata>
            <d2:siteReference id="CCTV_STATUS_MERGE" />
          </d2:metadata>
        </d2:payloadPublication>
      </d2:d2LogicalModel>
    `;

    expect(
      parseDatexCctv(siteXml, statusXml, {
        receivedAt: "2026-05-29T11:45:00.000Z",
      })[0],
    ).toMatchObject({
      cameraId: "CCTV_STATUS_MERGE",
      status: "ok",
      imageUrl: "https://webkamera.vegvesen.no/public/status-merge.jpg",
    });
  });

  it("does not treat generic links as image URLs", () => {
    const genericLink = "https://example.test/not-an-image-page";
    const siteXml = `
      <d2:d2LogicalModel xmlns:d2="http://datex2.eu/schema/3/common">
        <d2:payloadPublication>
          <d2:cctvCameraRecord id="CCTV_GENERIC_LINK">
            <d2:cctvCameraName><d2:values><d2:value>Samfundet</d2:value></d2:values></d2:cctvCameraName>
            <d2:coordinatesForDisplay><d2:latitude>63.4220</d2:latitude><d2:longitude>10.3950</d2:longitude></d2:coordinatesForDisplay>
            <d2:link>${genericLink}</d2:link>
          </d2:cctvCameraRecord>
        </d2:payloadPublication>
      </d2:d2LogicalModel>
    `;
    const statusXml = `
      <d2:d2LogicalModel xmlns:d2="http://datex2.eu/schema/3/common">
        <d2:payloadPublication>
          <d2:cctvCameraStatus>
            <d2:cctvCameraReference id="CCTV_GENERIC_LINK" />
            <d2:operationalStatus>operational</d2:operationalStatus>
            <d2:link>${genericLink}</d2:link>
          </d2:cctvCameraStatus>
        </d2:payloadPublication>
      </d2:d2LogicalModel>
    `;

    const camera = parseDatexCctv(siteXml, statusXml, {
      receivedAt: "2026-05-29T11:45:00.000Z",
    })[0];

    expect(camera).not.toHaveProperty("imageUrl");
    expect(camera).toMatchObject({
      cameraId: "CCTV_GENERIC_LINK",
      status: "ok",
      sourceUrl: genericLink,
    });
  });
});
