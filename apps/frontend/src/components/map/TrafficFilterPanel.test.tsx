import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TrafficFilterPanel, type TrafficLayerVisibility } from "./TrafficFilterPanel.js";

const visibleContextLayers: TrafficLayerVisibility = {
  incidents: true,
  roadworks: true,
  travelTime: true,
  publicTransportDisruptions: true,
  publicTransportVehicles: false,
  weatherRisk: false,
  estimatedNews: false,
  privateNotes: false,
  showAll: false,
};

describe("TrafficFilterPanel semantic layers", () => {
  it("renders semantic layer controls and collapses advanced filters", () => {
    const html = renderToStaticMarkup(
      <TrafficFilterPanel
        selectedCategories={["roadworks", "closure"]}
        selectedSeverities={["high", "critical"]}
        selectedPreset="now"
        visibleContextLayers={visibleContextLayers}
        onCategoriesChange={vi.fn()}
        onSeveritiesChange={vi.fn()}
        onPresetChange={vi.fn()}
        onContextLayersChange={vi.fn()}
      />,
    );

    expect(html).toContain("Kartlag");
    expect(html).toContain("Hendelser");
    expect(html).toContain("Veiarbeid");
    expect(html).toContain("Reisetidskorridorer");
    expect(html).toContain("Kollektivavvik");
    expect(html).toContain("Estimerte nyhetssteder");
    expect(html).not.toContain("Private notater/tegninger");
    expect(html).not.toContain("Aktiveres når estimerte nyhetssteder tegnes i kartet.");
    expect(html).toContain("Avanserte filtre");
    expect(html).toContain('aria-pressed="true"');
  });
});
