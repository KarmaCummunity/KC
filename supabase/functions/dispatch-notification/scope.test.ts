import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseDispatchScope, scopeToWire } from "./scope.ts";
const recipient = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const device = "11111111-2222-3333-4444-555555555555";
Deno.test("scope: every malformed field rejects the whole scope, not a broader subset", () => {
  const invalid: unknown[] = [
    undefined,
    null,
    [],
    "",
    1,
    true,
    {},
    { unknown: 1 },
    { event_ids: [] },
    { event_ids: null },
    { event_ids: [0] },
    { event_ids: [-1] },
    { event_ids: [1.1] },
    { event_ids: [NaN] },
    { event_ids: [Infinity] },
    { event_ids: [Number.MAX_SAFE_INTEGER + 1] },
    { event_ids: ["1"] },
    { event_ids: [1, "2"] },
    { event_ids: [1, null] },
    { event_ids: Array.from({ length: 101 }, (_, i) => i + 1) },
    { recipient_id: "" },
    { recipient_id: "invalid" },
    { recipient_id: null },
    { recipient_id: [] },
    { device_id: 1 },
    { notification_id: false },
    { recipient_id: recipient, event_ids: [] },
    { device_id: device, recipient_id: "invalid" },
    { event_ids: [1], unknown: true },
    { event_ids: [1], min_event_id: 1 },
  ];
  for (const value of invalid) {
    assertEquals(parseDispatchScope(value), null, JSON.stringify(value));
  }
});
Deno.test("scope: valid filters survive together and UUID case is normalized", () => {
  assertEquals(
    parseDispatchScope({
      event_ids: [1, 2, 1],
      recipient_id: recipient.toUpperCase(),
      device_id: device,
    }),
    { eventIds: [1, 2], recipientId: recipient, deviceId: device },
  );
  assertEquals(parseDispatchScope({ event_ids: [Number.MAX_SAFE_INTEGER] }), {
    eventIds: [Number.MAX_SAFE_INTEGER],
  });
  assertEquals(parseDispatchScope({ notification_id: recipient }), {
    notificationId: recipient,
  });
  assertEquals(parseDispatchScope({ recipient_id: recipient }), {
    recipientId: recipient,
  });
  assertEquals(parseDispatchScope({ device_id: device }), { deviceId: device });
  const wire = {
    event_ids: [5],
    notification_id: recipient,
    recipient_id: recipient,
    device_id: device,
  };
  assertEquals(scopeToWire(parseDispatchScope(wire)!), wire);
});
