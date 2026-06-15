import { useEffect } from "react";
import { useMap } from "react-leaflet";

export function MapAccessibility({
  label,
  role = "region",
}: {
  label: string;
  role?: "region" | "img";
}) {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    container.setAttribute("aria-label", label);
    container.setAttribute("role", role);
  }, [label, map, role]);

  return null;
}
