import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  cycleDashboardWidgetSize,
  moveDashboardWidget,
  normalizeDashboardLayout,
  parseDashboardLayout,
  type DashboardLayoutState,
  type DashboardWidgetSize,
} from "../dashboardLayout.js";

export interface DashboardWidgetDefinition {
  id: string;
  title: string;
  description?: string;
  defaultSize?: DashboardWidgetSize;
  children: ReactNode;
}

const sizeLabels: Record<DashboardWidgetSize, string> = {
  compact: "S",
  standard: "M",
  wide: "L",
  tall: "H",
  large: "XL",
};

function layoutFromStorage(storageKey: string): Partial<DashboardLayoutState> {
  if (typeof window === "undefined") return {};
  return parseDashboardLayout(window.localStorage.getItem(storageKey));
}

function saveLayout(storageKey: string, layout: DashboardLayoutState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(layout));
}

export function DashboardGrid({
  widgets,
  storageKey,
  ariaLabel = "Modulært dashboard",
}: {
  widgets: DashboardWidgetDefinition[];
  storageKey: string;
  ariaLabel?: string;
}) {
  const widgetLayoutInputs = useMemo(
    () => widgets.map(({ id, defaultSize }) => ({ id, defaultSize })),
    [widgets],
  );
  const [layout, setLayout] = useState(() =>
    normalizeDashboardLayout(widgetLayoutInputs, layoutFromStorage(storageKey)),
  );
  const draggedWidgetId = useRef<string | undefined>(undefined);

  useEffect(() => {
    setLayout((current) => normalizeDashboardLayout(widgetLayoutInputs, current));
  }, [widgetLayoutInputs]);

  useEffect(() => {
    saveLayout(storageKey, layout);
  }, [layout, storageKey]);

  const widgetsById = useMemo(
    () => new Map(widgets.map((widget) => [widget.id, widget])),
    [widgets],
  );
  const orderedWidgets = layout.order.flatMap((id) => {
    const widget = widgetsById.get(id);
    return widget ? [widget] : [];
  });

  const moveWidget = useCallback((id: string, targetIndex: number) => {
    setLayout((current) => moveDashboardWidget(current, id, targetIndex));
  }, []);

  const resetLayout = useCallback(() => {
    setLayout(normalizeDashboardLayout(widgetLayoutInputs));
  }, [widgetLayoutInputs]);

  function dragStarted(event: DragEvent<HTMLElement>, id: string) {
    draggedWidgetId.current = id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }

  function dropped(event: DragEvent<HTMLElement>, targetIndex: number) {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData("text/plain") || draggedWidgetId.current;
    if (!draggedId) return;
    moveWidget(draggedId, targetIndex);
    draggedWidgetId.current = undefined;
  }

  return (
    <section className="dashboard-layout" aria-label={ariaLabel}>
      <div className="dashboard-layout-toolbar">
        <div>
          <p className="label">Modulært oppsett</p>
          <h2>Command Center-arbeidsflate</h2>
        </div>
        <button type="button" onClick={resetLayout}>
          Tilbakestill
        </button>
      </div>
      <div className="dashboard-widget-grid">
        {orderedWidgets.map((widget, index) => {
          const size = layout.sizes[widget.id] ?? widget.defaultSize ?? "standard";
          return (
            <article
              className={`dashboard-widget dashboard-widget-${size}`}
              draggable
              key={widget.id}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={(event) => dragStarted(event, widget.id)}
              onDrop={(event) => dropped(event, index)}
            >
              <header className="dashboard-widget-header">
                <div>
                  <h3>{widget.title}</h3>
                  {widget.description ? <p>{widget.description}</p> : null}
                </div>
                <div
                  className="dashboard-widget-controls"
                  aria-label={`${widget.title} kontroller`}
                >
                  <button
                    type="button"
                    aria-label={`Flytt ${widget.title} tidligere`}
                    disabled={index === 0}
                    onClick={() => moveWidget(widget.id, index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Flytt ${widget.title} senere`}
                    disabled={index === orderedWidgets.length - 1}
                    onClick={() => moveWidget(widget.id, index + 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Endre størrelse på ${widget.title}`}
                    onClick={() =>
                      setLayout((current) => cycleDashboardWidgetSize(current, widget.id))
                    }
                  >
                    {sizeLabels[size]}
                  </button>
                </div>
              </header>
              <div className="dashboard-widget-body">{widget.children}</div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
