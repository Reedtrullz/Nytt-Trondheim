export interface IncidentTextInput {
  title: string;
  excerpt: string;
  category?: string;
}

export function incidentText(input: IncidentTextInput): string {
  return `${input.title} ${input.excerpt}`;
}

export function hasFireEmergencySignal(text: string): boolean {
  return /\b(skogbrann\w*|røyk\w*|brannvesen\w*|nødetat\w*|slukk\w*|evakuer\w*|flamme\w*|brannalarm\w*|branntilløp\w*|brannen|brann\s+(?:i|på|ved)\s+(?:[0-9a-zæøå-]+\s+){0,2}(?:bolig\w*|bygning\w*|garasje\w*|bod\w*|bil\w*|buss\w*|skole\w*|barnehage\w*|leilighet\w*|hus\w*|kjeller\w*|tak\w*|terrasse\w*|restaurant\w*|butikk\w*|institusjon\w*|skog\w*|mark\w*|bymarka)\b)\b/iu.test(
    text,
  );
}

export function isFootballClubBrannContext(input: IncidentTextInput): boolean {
  const text = incidentText(input);
  if (!/\bbrann\b/iu.test(text)) return false;
  if (hasFireEmergencySignal(text)) return false;
  if (input.category === "Sport") return true;
  const hasClubContext =
    /\b(rbk|fotball\w*|eliteserien|hovedtrener\w*|trener\w*|trenerjobb\w*|kamp\w*|lerkendal|bergenser\w*|spiller\w*)\b/iu.test(
      text,
    );
  const hasRosenborgMatchContext =
    /\brosenborg\w*\b/iu.test(text) &&
    /\b(møter|mot|kamp\w*|hovedtrener\w*|trener\w*|presentert\w*|ansatt\w*|spiller\w*|laget|lerkendal)\b/iu.test(
      text,
    );
  return hasClubContext || hasRosenborgMatchContext;
}
