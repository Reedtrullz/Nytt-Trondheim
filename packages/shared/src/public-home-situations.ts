import type { Situation } from "./types.js";

export const publicLeadLongRunningSituationAgeMs = 7 * 24 * 60 * 60 * 1000;

export type PublicHomeSituationFilterInput = Pick<
  Situation,
  "createdAt" | "locationLabel" | "status" | "summary" | "title" | "type"
> &
  Partial<Pick<Situation, "publicVisibility">>;

export type PublicHomeSituationSortInput = PublicHomeSituationFilterInput &
  Pick<Situation, "id" | "updatedAt"> &
  Partial<Pick<Situation, "importance" | "verificationStatus">>;

export function publicHomeSituationAgeMs(timestamp: string, now: Date): number | undefined {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, now.getTime() - parsed);
}

const trafficOrNaturePublicLeadPattern =
  /(^|[^a-z0-9æøå])(?:omkjøring|omkjoring|ras|skred|stengt|trafikk|veg|vegen|vei|veien)([^a-z0-9æøå]|$)/u;

const publicSafetyPublicLeadPattern =
  /(^|[^a-z0-9æøå])(?:bevæpnet|væpnet|trusselsituasjon|våpen|våpentrussel|kniv|skyting|voldshendelse|alvorlig skadd|kritisk skadd|savnet|leteaksjon|redningsaksjon)([^a-z0-9æøå]|$)/u;

const trafficInjuryPublicLeadPattern =
  /(^|[^a-z0-9æøå])(?:trafikkulykke|ulykke|kollisjon|påkjørt|påkjørsel|skadd|skadet|sykehus|kritisk|alvorlig)([^a-z0-9æøå]|$)/u;

function situationText(situation: PublicHomeSituationFilterInput): string {
  return `${situation.title} ${situation.summary} ${situation.locationLabel}`.toLocaleLowerCase(
    "nb",
  );
}

export function hasPublicSafetyThreatSignal(text: string): boolean {
  return publicSafetyPublicLeadPattern.test(text.toLocaleLowerCase("nb"));
}

export function isTrafficOrNaturePublicLead(situation: PublicHomeSituationFilterInput): boolean {
  if (
    situation.type === "traffic" ||
    situation.type === "landslide" ||
    situation.type === "weather"
  ) {
    return true;
  }
  return trafficOrNaturePublicLeadPattern.test(situationText(situation));
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

export function publicHomeSituationPriority(situation: PublicHomeSituationFilterInput): number {
  const text = situationText(situation);
  if (
    situation.type === "fire" ||
    situation.type === "missing_person" ||
    situation.type === "rescue" ||
    hasPublicSafetyThreatSignal(text)
  ) {
    return 4;
  }
  if (situation.type === "traffic" && trafficInjuryPublicLeadPattern.test(text)) {
    return 3;
  }
  if (situation.type === "service_disruption") {
    return 2;
  }
  if (isTrafficOrNaturePublicLead(situation)) {
    return 1;
  }
  return 2;
}

export function comparePublicHomeSituations(
  left: PublicHomeSituationSortInput,
  right: PublicHomeSituationSortInput,
): number {
  const priorityDelta = publicHomeSituationPriority(right) - publicHomeSituationPriority(left);
  if (priorityDelta !== 0) return priorityDelta;
  const importanceDelta =
    (right.importance === "high" ? 1 : 0) - (left.importance === "high" ? 1 : 0);
  if (importanceDelta !== 0) return importanceDelta;
  const verificationDelta =
    (right.verificationStatus === "Offentlig bekreftet" ? 1 : 0) -
    (left.verificationStatus === "Offentlig bekreftet" ? 1 : 0);
  if (verificationDelta !== 0) return verificationDelta;
  return right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
}
