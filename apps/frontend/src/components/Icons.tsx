export function BookmarkIcon({ selected = false }: { selected?: boolean }) {
  return (
    <svg className="icon bookmark" viewBox="0 0 24 24" aria-hidden="true">
      <path className={selected ? "filled" : ""} d="M6.5 3.5h11v17l-5.5-3.8-5.5 3.8z" />
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
