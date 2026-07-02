export const dashboardWidgetSizes = [
  "compact",
  "standard",
  "wide",
  "tall",
  "large",
  "full",
] as const;

export type DashboardWidgetSize = (typeof dashboardWidgetSizes)[number];

export interface DashboardLayoutState {
  order: string[];
  sizes: Record<string, DashboardWidgetSize>;
}

export interface DashboardLayoutWidget {
  id: string;
  defaultSize?: DashboardWidgetSize;
  resizable?: boolean;
}

const sizeSet = new Set<string>(dashboardWidgetSizes);

function isDashboardWidgetSize(value: string | undefined): value is DashboardWidgetSize {
  return Boolean(value && sizeSet.has(value));
}

export function normalizeDashboardLayout(
  widgets: DashboardLayoutWidget[],
  persisted?: Partial<DashboardLayoutState>,
): DashboardLayoutState {
  const widgetIds = new Set(widgets.map((widget) => widget.id));
  const order = [
    ...(persisted?.order ?? []).filter((id) => widgetIds.has(id)),
    ...widgets.map((widget) => widget.id).filter((id) => !(persisted?.order ?? []).includes(id)),
  ];
  const sizes: DashboardLayoutState["sizes"] = {};
  for (const widget of widgets) {
    const persistedSize = persisted?.sizes?.[widget.id];
    sizes[widget.id] =
      (widget.resizable ?? true) && isDashboardWidgetSize(persistedSize)
        ? persistedSize
        : (widget.defaultSize ?? "standard");
  }
  return { order, sizes };
}

export function moveDashboardWidget(
  layout: DashboardLayoutState,
  id: string,
  targetIndex: number,
): DashboardLayoutState {
  const currentIndex = layout.order.indexOf(id);
  if (currentIndex < 0) return layout;
  const boundedIndex = Math.max(0, Math.min(targetIndex, layout.order.length - 1));
  if (currentIndex === boundedIndex) return layout;
  const order = [...layout.order];
  const [item] = order.splice(currentIndex, 1);
  if (!item) return layout;
  order.splice(boundedIndex, 0, item);
  return { ...layout, order };
}

export function cycleDashboardWidgetSize(
  layout: DashboardLayoutState,
  id: string,
): DashboardLayoutState {
  const current = layout.sizes[id] ?? "standard";
  const currentIndex = dashboardWidgetSizes.indexOf(current);
  const nextSize = dashboardWidgetSizes[(currentIndex + 1) % dashboardWidgetSizes.length];
  return {
    ...layout,
    sizes: {
      ...layout.sizes,
      [id]: nextSize ?? "standard",
    },
  };
}

export function parseDashboardLayout(value: string | null): Partial<DashboardLayoutState> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const candidate = parsed as Partial<DashboardLayoutState>;
    return {
      order: Array.isArray(candidate.order)
        ? candidate.order.filter((id): id is string => typeof id === "string")
        : undefined,
      sizes:
        candidate.sizes && typeof candidate.sizes === "object"
          ? Object.fromEntries(
              Object.entries(candidate.sizes).filter(
                (entry): entry is [string, DashboardWidgetSize] =>
                  isDashboardWidgetSize(entry[1] as string | undefined),
              ),
            )
          : undefined,
    };
  } catch {
    return {};
  }
}
