import type { Situation } from "./types.js";

export const publicLeadLongRunningSituationAgeMs = 7 * 24 * 60 * 60 * 1000;

export type PublicHomeSituationFilterInput = Pick<
  Situation,
  "createdAt" | "locationLabel" | "status" | "summary" | "title" | "type"
> &
  Partial<Pick<Situation, "publicVisibility">>;

export function publicHomeSituationAgeMs(timestamp: string, now: Date): number | undefined {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, now.getTime() - parsed);
}

const trafficOrNaturePublicLeadPattern =
  /(^|[^a-z0-9æøå])(?:omkjøring|omkjoring|ras|skred|stengt|trafikk|veg|vegen|vei|veien)([^a-z0-9æøå]|$)/u;

export function isTrafficOrNaturePublicLead(situation: PublicHomeSituationFilterInput): boolean {
  if (
    situation.type === "traffic" ||
    situation.type === "landslide" ||
    situation.type === "weather"
  ) {
    return true;
  }
  const text =
    `${situation.title} ${situation.summary} ${situation.locationLabel}`.toLocaleLowerCase("nb");
  return trafficOrNaturePublicLeadPattern.test(text);
}

export function shouldFeaturePublicHomeSituation(
  situation: PublicHomeSituationFilterInput,
  now: Date,
): boolean {
  if ((situation.publicVisibility ?? "public") !== "public") return false;
  if (situation.status !== "preliminary" && situation.status !== "active") return false;
  const createdAge = publicHomeSituationAgeMs(situation.createdAt, now);
  return !(
    createdAge !== undefined &&
    createdAge > publicLeadLongRunningSituationAgeMs &&
    isTrafficOrNaturePublicLead(situation)
  );
}
