import type { SituationWorkspace } from "@nytt/shared";

type SituationPublicVisibility = NonNullable<SituationWorkspace["situation"]["publicVisibility"]>;

export function situationPublicationLabel(publicVisibility: SituationPublicVisibility) {
  return publicVisibility === "public" ? "City Pulse" : "Kun Command Center";
}

export function SituationPublicationBadge({
  publicVisibility,
}: {
  publicVisibility: SituationPublicVisibility;
}) {
  return (
    <span className={`trust-badge publication-${publicVisibility.replace("_", "-")}`}>
      {situationPublicationLabel(publicVisibility)}
    </span>
  );
}

export function SituationPublicationControls({
  publicVisibility,
  saving = false,
  onChange,
}: {
  publicVisibility: SituationPublicVisibility;
  saving?: boolean;
  onChange: (nextVisibility: SituationPublicVisibility) => void;
}) {
  return (
    <div className="publication-controls" aria-label="Publisering">
      <span>Publisering</span>
      <strong>
        {publicVisibility === "public"
          ? "Synlig for lesere"
          : situationPublicationLabel(publicVisibility)}
      </strong>
      <div>
        <button
          type="button"
          disabled={saving || publicVisibility === "public"}
          onClick={() => onChange("public")}
        >
          Vis i City Pulse
        </button>
        <button
          type="button"
          disabled={saving || publicVisibility === "command_center"}
          onClick={() => onChange("command_center")}
        >
          Kun Command Center
        </button>
      </div>
    </div>
  );
}

export type { SituationPublicVisibility };
