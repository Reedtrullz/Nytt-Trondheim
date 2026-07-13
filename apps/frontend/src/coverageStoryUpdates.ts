import type { CityPulseStory } from "@nytt/shared";

function storyOrder(left: CityPulseStory, right: CityPulseStory): number {
  return right.latestAt.localeCompare(left.latestAt) || right.id.localeCompare(left.id);
}

export function replaceCoverageStories(
  current: CityPulseStory[],
  removedStoryIds: string[],
  replacementStories: CityPulseStory[],
): CityPulseStory[] {
  const removed = new Set(removedStoryIds);
  const byId = new Map<string, CityPulseStory>();
  for (const story of current) {
    if (!removed.has(story.id)) byId.set(story.id, story);
  }
  for (const story of replacementStories) byId.set(story.id, story);
  return [...byId.values()].sort(storyOrder);
}
