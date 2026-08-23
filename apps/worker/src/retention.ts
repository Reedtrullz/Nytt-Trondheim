import type pg from "pg";

export interface RetentionConfig {
  capturesDays: number;
  collectorRunsDays: number;
  telemetryHistoryDays: number;
  vehicleRowsDays: number;
  pushDeliveriesDays: number;
}

export function retentionConfig(env: NodeJS.ProcessEnv = process.env): RetentionConfig {
  const parseDays = (name: string, fallback: number): number => {
    const value = Number(env[name]);
    return Number.isFinite(value) && Number.isInteger(value) && value >= 1 ? value : fallback;
  };
  return {
    capturesDays: parseDays("RETENTION_SOURCE_ITEM_CAPTURES_DAYS", 30),
    collectorRunsDays: parseDays("RETENTION_COLLECTOR_RUNS_DAYS", 90),
    telemetryHistoryDays: parseDays("RETENTION_TELEMETRY_HISTORY_DAYS", 30),
    vehicleRowsDays: parseDays("RETENTION_VEHICLE_ROWS_DAYS", 7),
    pushDeliveriesDays: parseDays("RETENTION_PUSH_DELIVERIES_DAYS", 180),
  };
}

export interface RetentionResult {
  sourceItemCaptures: number;
  collectorRuns: number;
  datexTravelTimeHistory: number;
  trafficCounterSnapshotHistory: number;
  expiredVehicles: number;
  pushNotificationDeliveries: number;
}

function countFromDelete(result: { rowCount: number | null }): number {
  return result.rowCount ?? 0;
}

export async function pruneExpiredData(
  pool: pg.Pool,
  config: RetentionConfig,
): Promise<RetentionResult> {
  const result: RetentionResult = {
    sourceItemCaptures: 0,
    collectorRuns: 0,
    datexTravelTimeHistory: 0,
    trafficCounterSnapshotHistory: 0,
    expiredVehicles: 0,
    pushNotificationDeliveries: 0,
  };
  result.sourceItemCaptures = countFromDelete(
    await pool.query(
      "DELETE FROM source_item_captures WHERE captured_at < now() - make_interval(days => $1::int)",
      [config.capturesDays],
    ),
  );
  result.collectorRuns = countFromDelete(
    await pool.query(
      "DELETE FROM collector_runs WHERE started_at < now() - make_interval(days => $1::int)",
      [config.collectorRunsDays],
    ),
  );
  result.datexTravelTimeHistory = countFromDelete(
    await pool.query(
      "DELETE FROM datex_travel_time_history WHERE observed_at < now() - make_interval(days => $1::int)",
      [config.telemetryHistoryDays],
    ),
  );
  result.trafficCounterSnapshotHistory = countFromDelete(
    await pool.query(
      "DELETE FROM traffic_counter_snapshot_history WHERE observed_at < now() - make_interval(days => $1::int)",
      [config.telemetryHistoryDays],
    ),
  );
  result.expiredVehicles = countFromDelete(
    await pool.query(
      "DELETE FROM public_transport_vehicles WHERE expires_at IS NOT NULL AND expires_at < now() - make_interval(days => $1::int)",
      [config.vehicleRowsDays],
    ),
  );
  result.pushNotificationDeliveries = countFromDelete(
    await pool.query(
      "DELETE FROM push_notification_deliveries WHERE created_at < now() - make_interval(days => $1::int)",
      [config.pushDeliveriesDays],
    ),
  );
  return result;
}
