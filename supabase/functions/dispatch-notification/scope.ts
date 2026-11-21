// Reject malformed scopes whole. Never discard a bad filter and run a broader one.
export interface DispatchScope {
  readonly eventIds?: readonly number[];
  readonly notificationId?: string;
  readonly recipientId?: string;
  readonly deviceId?: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_KEYS = new Set([
  "event_ids",
  "notification_id",
  "recipient_id",
  "device_id",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseDispatchScope(value: unknown): DispatchScope | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key]) => !SCOPE_KEYS.has(key))) {
    return null;
  }
  const result: {
    eventIds?: number[];
    notificationId?: string;
    recipientId?: string;
    deviceId?: string;
  } = {};
  for (const [key, filter] of entries) {
    if (key === "event_ids") {
      if (
        !Array.isArray(filter) || filter.length < 1 || filter.length > 100 ||
        filter.some((id) =>
          typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0
        )
      ) return null;
      result.eventIds = [...new Set(filter as number[])];
    } else {
      if (typeof filter !== "string" || !UUID.test(filter)) return null;
      const target = {
        notification_id: "notificationId",
        recipient_id: "recipientId",
        device_id: "deviceId",
      }[key];
      result[target as "notificationId" | "recipientId" | "deviceId"] = filter
        .toLowerCase();
    }
  }
  return result;
}

export function scopeToWire(scope: DispatchScope): Record<string, unknown> {
  return {
    ...(scope.eventIds ? { event_ids: scope.eventIds } : {}),
    ...(scope.notificationId ? { notification_id: scope.notificationId } : {}),
    ...(scope.recipientId ? { recipient_id: scope.recipientId } : {}),
    ...(scope.deviceId ? { device_id: scope.deviceId } : {}),
  };
}
