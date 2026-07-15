export type EditorialTextRejectionReason = "too_short" | "headline_duplicate" | "boilerplate";

export interface EditorialTextPolicyOptions {
  title?: string;
  minLength?: number;
}

const editorialBoilerplatePatterns = [
  /(?:vær\s+varsom-plakaten|redaktøransvar|medietilsynet|urettmessig\s+medieomtale)/iu,
  /\b(?:artikkelen|saken)\s+er\s+for\s+abonnenter\b/iu,
  /\b(?:allerede|er\s+du)\s+abonnent\b.{0,100}\blogg\s+inn\b/iu,
  /\blogg\s+inn\b.{0,100}\b(?:les|fortsett|abonnent|nyheter|anbefalinger)\b/iu,
  /\b(?:kjøp|bestill|tegn)\s+(?:et\s+)?abonnement\b/iu,
  /\bvi\s+bruker\s+(?:informasjonskapsler|cookies)\b/iu,
  /\b(?:gå|tilbake)\s+til\s+forsiden\b/iu,
  /^foto\s*:/iu,
];

export function normalizedEditorialText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function comparableEditorialText(value: string): string {
  return normalizedEditorialText(value)
    .toLocaleLowerCase("nb")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function editorialTextRejectionReason(
  value: string,
  options: EditorialTextPolicyOptions = {},
): EditorialTextRejectionReason | undefined {
  const normalized = normalizedEditorialText(value);
  if (normalized.length < (options.minLength ?? 24)) return "too_short";
  if (
    options.title &&
    comparableEditorialText(normalized) === comparableEditorialText(options.title)
  ) {
    return "headline_duplicate";
  }
  if (editorialBoilerplatePatterns.some((pattern) => pattern.test(normalized))) {
    return "boilerplate";
  }
  return undefined;
}
