import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SituationPublicationBadge,
  SituationPublicationControls,
} from "../components/situations/SituationPublicationControls.js";

describe("SituationPublicationControls", () => {
  it("shows the current public publishing state and disables the active choice", () => {
    const html = renderToStaticMarkup(
      <SituationPublicationControls publicVisibility="public" onChange={() => undefined} />,
    );

    expect(html).toContain("Publisering");
    expect(html).toContain("Synlig for lesere");
    expect(html).toContain("Vis i City Pulse");
    expect(html).toContain("Kun Command Center");
    expect(html).toContain("disabled");
  });

  it("shows command-center-only state for unpublished situations", () => {
    const html = renderToStaticMarkup(
      <SituationPublicationControls publicVisibility="command_center" onChange={() => undefined} />,
    );

    expect(html).toContain("Kun Command Center");
    expect(html).toContain("Vis i City Pulse");
  });

  it("renders compact publication badges for situation lists", () => {
    expect(renderToStaticMarkup(<SituationPublicationBadge publicVisibility="public" />)).toContain(
      "City Pulse",
    );
    expect(
      renderToStaticMarkup(<SituationPublicationBadge publicVisibility="command_center" />),
    ).toContain("Kun Command Center");
  });
});
