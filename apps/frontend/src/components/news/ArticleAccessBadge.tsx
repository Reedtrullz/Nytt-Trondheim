import type { Article } from "@nytt/shared";

export function ArticleAccessBadge({ access }: { access?: Article["access"] }) {
  if (access !== "paid") return null;
  return (
    <span
      className="story-badge story-badge-paid"
      aria-label="Plussak. Krever abonnement hos kilden."
      title="Krever abonnement hos kilden"
    >
      Pluss
    </span>
  );
}
