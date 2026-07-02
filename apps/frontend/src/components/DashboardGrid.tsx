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
  resizable?: boolean;
  children: ReactNode;
}

type DashboardWidgetChrome = "card" | "bare";

const sizeLabels: Record<DashboardWidgetSize, string> = {
  compact: "S",
  standard: "M",
  wide: "L",
  tall: "H",
  large: "XL",
  full: "F",
};

function layoutFromStorage(storageKey: string | undefined): Partial<DashboardLayoutState> {
  if (typeof window === "undefined" || !storageKey) return {};
  return parseDashboardLayout(window.localStorage.getItem(storageKey));
}

function saveLayout(storageKey: string | undefined, layout: DashboardLayoutState) {
  if (typeof window === "undefined" || !storageKey) return;
  window.localStorage.setItem(storageKey, JSON.stringify(layout));
}

export function DashboardGrid({
  widgets,
  storageKey,
  ariaLabel = "Modulært dashboard",
  label = "Modulært oppsett",
  title = "Command Center-arbeidsflate",
  description,
  editable = true,
  showToolbar = true,
  showWidgetHeaders = true,
  widgetChrome = "card",
  variant = "command",
}: {
  widgets: DashboardWidgetDefinition[];
  storageKey?: string;
  ariaLabel?: string;
  label?: string;
  title?: string;
  description?: string;
  editable?: boolean;
  showToolbar?: boolean;
  showWidgetHeaders?: boolean;
  widgetChrome?: DashboardWidgetChrome;
  variant?: "command" | "city-pulse";
}) {
  const widgetLayoutInputs = useMemo(
    () => widgets.map(({ id, defaultSize, resizable }) => ({ id, defaultSize, resizable })),
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
    if (!editable) return;
    draggedWidgetId.current = id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }

  function dropped(event: DragEvent<HTMLElement>, targetIndex: number) {
    if (!editable) return;
    event.preventDefault();
    const draggedId = event.dataTransfer.getData("text/plain") || draggedWidgetId.current;
    if (!draggedId) return;
    moveWidget(draggedId, targetIndex);
    draggedWidgetId.current = undefined;
  }

  return (
    <section className={`dashboard-layout dashboard-layout-${variant}`} aria-label={ariaLabel}>
      {showToolbar ? (
        <div className="dashboard-layout-toolbar">
          <div>
            <p className="label">{label}</p>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {editable ? (
            <button type="button" onClick={resetLayout}>
              Tilbakestill
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="dashboard-widget-grid">
        {orderedWidgets.map((widget, index) => {
          const size = layout.sizes[widget.id] ?? widget.defaultSize ?? "standard";
          const resizable = widget.resizable ?? true;
          return (
            <article
              className={`dashboard-widget dashboard-widget-${size} dashboard-widget-${widgetChrome}`}
              data-editable={editable ? "true" : "false"}
              draggable={editable}
              key={widget.id}
              onDragOver={editable ? (event) => event.preventDefault() : undefined}
              onDragStart={(event) => dragStarted(event, widget.id)}
              onDrop={(event) => dropped(event, index)}
            >
              {showWidgetHeaders ? (
                <header className="dashboard-widget-header">
                  <div>
                    <h3>{widget.title}</h3>
                    {widget.description ? <p>{widget.description}</p> : null}
                  </div>
                  {editable ? (
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
                      {resizable ? (
                        <button
                          type="button"
                          aria-label={`Endre størrelse på ${widget.title}`}
                          onClick={() =>
                            setLayout((current) => cycleDashboardWidgetSize(current, widget.id))
                          }
                        >
                          {sizeLabels[size]}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </header>
              ) : null}
              <div className="dashboard-widget-body">{widget.children}</div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
