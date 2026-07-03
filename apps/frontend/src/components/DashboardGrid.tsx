import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  cycleDashboardWidgetSize,
  dashboardWidgetSizes,
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
type DashboardConfigMode = "always" | "toggle";

const sizeLabels: Record<DashboardWidgetSize, string> = {
  compact: "S",
  standard: "M",
  wide: "L",
  tall: "H",
  large: "XL",
  full: "F",
};

const sizeNames: Record<DashboardWidgetSize, string> = {
  compact: "Kompakt",
  standard: "Normal",
  wide: "Bred",
  tall: "Høy",
  large: "Stor",
  full: "Full bredde",
};

function getNextWidgetSize(size: DashboardWidgetSize): DashboardWidgetSize {
  const currentIndex = dashboardWidgetSizes.indexOf(size);
  return dashboardWidgetSizes[(currentIndex + 1) % dashboardWidgetSizes.length] ?? "standard";
}

function getSizeCycleHint(size: DashboardWidgetSize): string {
  const nextSize = getNextWidgetSize(size);
  return `Nå: ${sizeNames[size]}. Neste: ${sizeNames[nextSize]}.`;
}

function layoutFromStorage(storageKey: string | undefined): Partial<DashboardLayoutState> {
  if (typeof window === "undefined" || !storageKey) return {};
  try {
    return parseDashboardLayout(window.localStorage.getItem(storageKey));
  } catch {
    return {};
  }
}

function saveLayout(storageKey: string | undefined, layout: DashboardLayoutState) {
  if (typeof window === "undefined" || !storageKey) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    // Layout preferences are optional; blocked storage should not break the dashboard.
  }
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
  configMode = "always",
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
  configMode?: DashboardConfigMode;
}) {
  const widgetLayoutInputs = useMemo(
    () => widgets.map(({ id, defaultSize, resizable }) => ({ id, defaultSize, resizable })),
    [widgets],
  );
  const [layout, setLayout] = useState(() =>
    normalizeDashboardLayout(widgetLayoutInputs, layoutFromStorage(storageKey)),
  );
  const [configOpen, setConfigOpen] = useState(configMode === "always");
  const configId = useId();
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

  const editingActive = editable && (configMode === "always" || configOpen);
  const hasEditableConfig = editable && orderedWidgets.length > 1;
  const showConfig = hasEditableConfig && editingActive;
  const showConfigToggle = hasEditableConfig && configMode === "toggle";
  const showReset = editable && (configMode === "always" || configOpen);
  const showToolbarActions = showConfigToggle || showReset;

  function dragStarted(event: DragEvent<HTMLElement>, id: string) {
    if (!editingActive) return;
    draggedWidgetId.current = id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }

  function dropped(event: DragEvent<HTMLElement>, targetIndex: number) {
    if (!editingActive) return;
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
          {showToolbarActions ? (
            <div className="dashboard-layout-actions">
              {showConfigToggle ? (
                <button
                  type="button"
                  aria-expanded={configOpen}
                  aria-controls={configId}
                  onClick={() => setConfigOpen((current) => !current)}
                >
                  {configOpen ? "Skjul oppsett" : "Tilpass oppsett"}
                </button>
              ) : null}
              {showReset ? (
                <button type="button" onClick={resetLayout}>
                  Tilbakestill
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {showConfig ? (
        <div className="dashboard-layout-config" id={configId} aria-label="Dashboard-oppsett">
          <div>
            <strong>Oppsett</strong>
            <span>Dra moduler, eller bruk knappene for rekkefølge og størrelse.</span>
          </div>
          <ol>
            {orderedWidgets.map((widget, index) => {
              const size = layout.sizes[widget.id] ?? widget.defaultSize ?? "standard";
              const nextSize = getNextWidgetSize(size);
              const resizable = widget.resizable ?? true;
              return (
                <li key={widget.id}>
                  <span>
                    <b>{widget.title}</b>
                    <small>{sizeNames[size]}</small>
                  </span>
                  <div aria-label={`${widget.title} layout`}>
                    <button
                      type="button"
                      aria-label={`Flytt ${widget.title} opp i oppsettet`}
                      disabled={index === 0}
                      onClick={() => moveWidget(widget.id, index - 1)}
                    >
                      Opp
                    </button>
                    <button
                      type="button"
                      aria-label={`Flytt ${widget.title} ned i oppsettet`}
                      disabled={index === orderedWidgets.length - 1}
                      onClick={() => moveWidget(widget.id, index + 1)}
                    >
                      Ned
                    </button>
                    {resizable ? (
                      <button
                        type="button"
                        aria-label={`Bytt modulstørrelse for ${widget.title}`}
                        data-next-size={nextSize}
                        data-size={size}
                        title={getSizeCycleHint(size)}
                        onClick={() =>
                          setLayout((current) => cycleDashboardWidgetSize(current, widget.id))
                        }
                      >
                        {sizeLabels[size]}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
      <div className="dashboard-widget-grid">
        {orderedWidgets.map((widget, index) => {
          const size = layout.sizes[widget.id] ?? widget.defaultSize ?? "standard";
          const nextSize = getNextWidgetSize(size);
          const resizable = widget.resizable ?? true;
          return (
            <article
              className={`dashboard-widget dashboard-widget-${size} dashboard-widget-${widgetChrome}`}
              data-editable={editingActive ? "true" : "false"}
              draggable={editingActive}
              key={widget.id}
              onDragOver={editingActive ? (event) => event.preventDefault() : undefined}
              onDragStart={(event) => dragStarted(event, widget.id)}
              onDrop={(event) => dropped(event, index)}
            >
              {showWidgetHeaders ? (
                <header className="dashboard-widget-header">
                  <div>
                    <h3>{widget.title}</h3>
                    {widget.description ? <p>{widget.description}</p> : null}
                  </div>
                  {editingActive ? (
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
                          data-next-size={nextSize}
                          data-size={size}
                          title={getSizeCycleHint(size)}
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
