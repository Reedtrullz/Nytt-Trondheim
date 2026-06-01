import type {
  PublicTransportServiceAlert,
  PublicTransportVehicle,
  TrafficCorridorImpact,
  TrafficMapEvent,
} from "@nytt/shared";

export type TrafficTrustBadge =
  | "OFFISIELL"
  | "ESTIMERT"
  | "REISETID"
  | "VARSELKONTEKST"
  | "KOLLEKTIV"
  | "NYHETSKILDE";

export function sourceDisplayLabel(source: TrafficMapEvent["source"]): string {
  switch (source) {
    case "vegvesen_traffic_info":
      return "Statens vegvesen TrafficInfo";
    case "datex":
      return "Statens vegvesen DATEX Situation";
    default:
      return source;
  }
}

export function badgesForTrafficEvent(event: TrafficMapEvent): TrafficTrustBadge[] {
  const badges: TrafficTrustBadge[] = ["OFFISIELL"];
  if (event.relatedArticles?.some((article) => article.location)) {
    badges.push("ESTIMERT", "NYHETSKILDE");
  }
  return badges;
}

export function badgeForTrafficPulse(
  impact: TrafficCorridorImpact,
): TrafficTrustBadge | undefined {
  return impact.travelTime ? "REISETID" : undefined;
}

export function badgeForWeatherContext(): TrafficTrustBadge {
  return "VARSELKONTEKST";
}

export function badgeForPublicTransportAlert(
  _alert: PublicTransportServiceAlert,
): TrafficTrustBadge {
  return "KOLLEKTIV";
}

export function badgeForPublicTransportVehicle(
  _vehicle: PublicTransportVehicle,
): TrafficTrustBadge {
  return "KOLLEKTIV";
}
