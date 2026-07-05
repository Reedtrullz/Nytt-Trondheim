const localClubPattern =
  /\b(?:by[åa]sen(?:s)?|kolstad(?:s)?|levanger(?:s)?|nardo(?:s)?|ranheim(?:s)?|rbk|rosenborg(?:s)?|stj[øo]rdals(?:-|\s*)blink|stj[øo]rdalsblink|strindheim(?:s)?)\b/iu;

const sportsContextPattern =
  /\b(?:bortekompleks\w*|bortesmell\w*|bortetap\w*|divisjon\w*|eliteserien|fotball\w*|hjemmekamp\w*|hjemmelaget|hovedtrener\w*|h[åa]ndball\w*|kamp(?:en)?|liga(?:en)?|m[åa]l(?:et|ene|l[øo]s)?|obos|poeng\w*|profil\w*|resultat(?:et)?|seier\w*|slo|spiller\w*|tap(?:et|te)?|trener\w*|uavgjort)\b|\b\d+\s*[–-]\s*\d+\b/iu;

export function isLocalSportsCoverageText(text: string): boolean {
  return localClubPattern.test(text) && sportsContextPattern.test(text);
}
