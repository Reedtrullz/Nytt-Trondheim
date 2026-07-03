import type { ArticleCategory } from "@nytt/shared";

export type ArticleCategoryIconName = ArticleCategory | "Alle";

export function BookmarkIcon({ selected = false }: { selected?: boolean }) {
  return (
    <svg className="icon bookmark" viewBox="0 0 24 24" aria-hidden="true">
      <path className={selected ? "filled" : ""} d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z" />
    </svg>
  );
}

export function ArticleCategoryIcon({ name }: { name: ArticleCategoryIconName }) {
  return (
    <svg className="icon channel-icon" viewBox="0 0 24 24" aria-hidden="true">
      {name === "Alle" ? (
        <>
          <circle cx="7" cy="7" r="2.4" />
          <circle cx="17" cy="7" r="2.4" />
          <circle cx="7" cy="17" r="2.4" />
          <circle cx="17" cy="17" r="2.4" />
        </>
      ) : null}
      {name === "Hendelser" ? (
        <>
          <path d="M12 4.5 21 19H3z" />
          <path d="M12 9v4.4" />
          <path d="M12 16.8h.01" />
        </>
      ) : null}
      {name === "Krim" ? (
        <>
          <path d="M12 3.8 19 6.6v5.2c0 4.5-2.7 7-7 8.4-4.3-1.4-7-3.9-7-8.4V6.6z" />
          <path d="M9 12.1h6" />
        </>
      ) : null}
      {name === "Transport" ? (
        <>
          <path d="M4 16h16" />
          <path d="M6 16l2.6-7.5h6.8L18 16" />
          <path d="M8 18.5h.01" />
          <path d="M16 18.5h.01" />
        </>
      ) : null}
      {name === "Sport" ? (
        <>
          <path d="M7 20V4" />
          <path d="M7 5h10l-2 4 2 4H7" />
        </>
      ) : null}
      {name === "Politikk" ? (
        <>
          <path d="M4 20h16" />
          <path d="M6 17V9" />
          <path d="M12 17V9" />
          <path d="M18 17V9" />
          <path d="M3.8 9 12 4l8.2 5z" />
        </>
      ) : null}
      {name === "Byutvikling" ? (
        <>
          <path d="M5 20V8h5v12" />
          <path d="M14 20V4h5v16" />
          <path d="M7 11h1" />
          <path d="M16 8h1" />
          <path d="M16 12h1" />
        </>
      ) : null}
      {name === "Kultur" ? (
        <>
          <path d="M6 6h12v12H6z" />
          <path d="M9 6v12" />
          <path d="M15 6v12" />
          <path d="M6 10h12" />
          <path d="M6 14h12" />
        </>
      ) : null}
      {name === "Nyheter" ? (
        <>
          <path d="M5 5.5h12.5A1.5 1.5 0 0 1 19 7v11H6.5A1.5 1.5 0 0 1 5 16.5z" />
          <path d="M8 9h8" />
          <path d="M8 12h8" />
          <path d="M8 15h5" />
        </>
      ) : null}
      {name === "Vær" ? (
        <>
          <path d="M7.2 16.5h9.2a3.4 3.4 0 0 0 .3-6.8 5 5 0 0 0-9.6 1.2 2.8 2.8 0 0 0 .1 5.6z" />
          <path d="M8 20v.01" />
          <path d="M12 20v.01" />
          <path d="M16 20v.01" />
        </>
      ) : null}
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg className="icon arrow" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}
