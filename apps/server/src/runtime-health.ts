import { monitorEventLoopDelay } from "node:perf_hooks";
import type { Request, Response } from "express";
import type pg from "pg";
import type {
  TrafficDependencyId,
  TrafficDependencyState,
  TrafficDependencyStatus,
} from "@nytt/shared";

type RequestSample = {
  method: string;
  route: string;
  status: number;
  durationMs: number;
  finishedAt: string;
};

type RequestAggregate = {
  route: string;
  method: string;
  count: number;
  errorCount: number;
  averageMs: number;
  maxMs: number;
  p95Ms: number;
};

export type PoolStats = {
  total: number;
  idle: number;
  waiting: number;
};

export type RuntimeHealthSnapshot = {
  status: "ok" | "degraded";
  generatedAt: string;
  eventLoop: {
    lagMs: number;
    p95Ms: number;
  };
  pool: PoolStats;
  dependencies: TrafficDependencyStatus[];
  requests: {
    slow: RequestSample[];
    recent: RequestSample[];
    summary: RequestAggregate[];
  };
};

const dependencyLabels: Record<TrafficDependencyId, string> = {
  entur_journey_planner: "Entur reisesøk",
  entur_departure_board: "Entur avgangstavle",
  entur_geocoder: "Entur geocoder",
  nominatim: "Nominatim geokoding",
  osrm: "OSRM rute",
  postgres: "Postgres",
  traffic_map_read: "Trafikkart lesing",
};

const requestSampleLimit = 250;
const slowRequestLimit = 60;
const slowRequestThresholdMs = 750;

function nowIso(): string {
  return new Date().toISOString();
}

function finiteMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function poolStats(pool?: pg.Pool): PoolStats {
  if (!pool) return { total: 0, idle: 0, waiting: 0 };
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

function routeLabel(req: Request): string {
  const routePath = req.route?.path;
  if (typeof routePath === "string") return `${req.baseUrl}${routePath}`;
  return req.originalUrl.split("?")[0] || req.path || "/";
}

function aggregateRequests(samples: RequestSample[]): RequestAggregate[] {
  const groups = new Map<string, RequestSample[]>();
  for (const sample of samples) {
    const key = `${sample.method} ${sample.route}`;
    const entries = groups.get(key);
    if (entries) {
      entries.push(sample);
    } else {
      groups.set(key, [sample]);
    }
  }
  return [...groups.entries()]
    .map(([key, entries]) => {
      const durations = entries
        .map((entry) => entry.durationMs)
        .sort((left, right) => left - right);
      const p95Index = Math.max(0, Math.ceil(durations.length * 0.95) - 1);
      const total = durations.reduce((sum, duration) => sum + duration, 0);
      const [method, ...routeParts] = key.split(" ");
      return {
        method: method ?? "GET",
        route: routeParts.join(" ") || "/",
        count: entries.length,
        errorCount: entries.filter((entry) => entry.status >= 500).length,
        averageMs: finiteMs(total / Math.max(1, entries.length)),
        maxMs: finiteMs(durations.at(-1) ?? 0),
        p95Ms: finiteMs(durations[p95Index] ?? 0),
      };
    })
    .sort((left, right) => right.p95Ms - left.p95Ms || right.count - left.count)
    .slice(0, 20);
}

class RuntimeHealthMonitor {
  private readonly histogram = monitorEventLoopDelay({ resolution: 20 });
  private readonly requests: RequestSample[] = [];
  private readonly slowRequests: RequestSample[] = [];
  private readonly dependencies = new Map<TrafficDependencyId, TrafficDependencyStatus>();

  constructor() {
    this.histogram.enable();
  }

  reset(): void {
    this.requests.length = 0;
    this.slowRequests.length = 0;
    this.dependencies.clear();
    this.histogram.reset();
  }

  middleware() {
    return (req: Request, res: Response, next: () => void) => {
      const startedAt = process.hrtime.bigint();
      res.on("finish", () => {
        const durationMs = finiteMs(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
        this.recordRequest({
          method: req.method,
          route: routeLabel(req),
          status: res.statusCode,
          durationMs,
          finishedAt: nowIso(),
        });
      });
      next();
    };
  }

  recordRequest(sample: RequestSample): void {
    this.requests.unshift(sample);
    if (this.requests.length > requestSampleLimit) this.requests.length = requestSampleLimit;
    if (sample.durationMs >= slowRequestThresholdMs || sample.status >= 500) {
      this.slowRequests.unshift(sample);
      if (this.slowRequests.length > slowRequestLimit) {
        this.slowRequests.length = slowRequestLimit;
      }
    }
  }

  recordDependency(
    id: TrafficDependencyId,
    state: TrafficDependencyState,
    detail: string,
    options: { latencyMs?: number; retryAfterSeconds?: number } = {},
  ): TrafficDependencyStatus {
    const previous = this.dependencies.get(id);
    const status: TrafficDependencyStatus = {
      id,
      label: dependencyLabels[id],
      state,
      detail,
      checkedAt: nowIso(),
      ...(options.latencyMs !== undefined ? { latencyMs: finiteMs(options.latencyMs) } : {}),
      ...(options.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: options.retryAfterSeconds }
        : {}),
      ...(state === "ok"
        ? {
            lastSuccessAt: nowIso(),
            ...(previous?.lastFailureAt ? { lastFailureAt: previous.lastFailureAt } : {}),
          }
        : {
            ...(previous?.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
            lastFailureAt: nowIso(),
          }),
    };
    this.dependencies.set(id, status);
    return status;
  }

  dependencySnapshot(ids?: TrafficDependencyId[]): TrafficDependencyStatus[] {
    const selected = ids ?? (Object.keys(dependencyLabels) as TrafficDependencyId[]);
    return selected.map((id) => {
      const current = this.dependencies.get(id);
      if (current) return current;
      return {
        id,
        label: dependencyLabels[id],
        state: "unknown",
        detail: "Ikke kontrollert i denne serverprosessen ennå.",
        checkedAt: nowIso(),
      };
    });
  }

  snapshot(pool?: pg.Pool): RuntimeHealthSnapshot {
    const lagMs = finiteMs(this.histogram.mean / 1_000_000);
    const p95Ms = finiteMs(this.histogram.percentile(95) / 1_000_000);
    const stats = poolStats(pool);
    const dependencies = this.dependencySnapshot();
    const degraded =
      stats.waiting > 0 ||
      p95Ms > 200 ||
      dependencies.some((dependency) =>
        ["unavailable", "timeout", "rate_limited", "circuit_open"].includes(dependency.state),
      );
    return {
      status: degraded ? "degraded" : "ok",
      generatedAt: nowIso(),
      eventLoop: {
        lagMs,
        p95Ms,
      },
      pool: stats,
      dependencies,
      requests: {
        slow: [...this.slowRequests],
        recent: this.requests.slice(0, 50),
        summary: aggregateRequests(this.requests),
      },
    };
  }
}

export const runtimeHealth = new RuntimeHealthMonitor();

export function runtimePoolStats(pool?: pg.Pool): PoolStats {
  return poolStats(pool);
}
