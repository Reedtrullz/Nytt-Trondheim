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
    case "news_article":
      return "Nyhetskilde (estimert)";
    default:
      return source;
  }
}

export function badgesForTrafficEvent(event: TrafficMapEvent): TrafficTrustBadge[] {
  if (event.source === "news_article") return ["ESTIMERT", "NYHETSKILDE"];
  const badges: TrafficTrustBadge[] = ["OFFISIELL"];
  if (event.relatedArticles?.some((article) => article.location)) {
    badges.push("ESTIMERT", "NYHETSKILDE");
  }
  return badges;
}

export function badgeForTrafficPulse(impact: TrafficCorridorImpact): TrafficTrustBadge | undefined {
  return impact.travelTime ? "REISETID" : undefined;
}

export function badgeForWeatherContext(): TrafficTrustBadge {
  return "VARSELKONTEKST";
}

export function badgeForPublicTransportAlert(
  alert: PublicTransportServiceAlert,
): TrafficTrustBadge {
  void alert;
  return "KOLLEKTIV";
}

export function badgeForPublicTransportVehicle(vehicle: PublicTransportVehicle): TrafficTrustBadge {
  void vehicle;
  return "KOLLEKTIV";
}
