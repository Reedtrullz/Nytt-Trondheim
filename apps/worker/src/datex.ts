import type { OfficialEvent } from "@nytt/shared";

export interface DatexParseOptions {
  endpoint: string;
  receivedAt: string;
}

export interface DatexParseResult {
  events: OfficialEvent[];
}

export function parseDatexSituationPublication(
  xml: string,
  options: DatexParseOptions,
): DatexParseResult {
  void xml;
  void options;

  return { events: [] };
}
