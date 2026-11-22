import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createDispatchHandler } from "./handler.ts";

Deno.test("refused dispatch callers receive the shared JSON response without touching IO", async () => {
  const unreachable = new Proxy({}, {
    get() {
      throw new Error("refused caller reached IO");
    },
  });
  const handler = createDispatchHandler({
    db: unreachable as never,
    transport: unreachable as never,
    serviceRoleKey: "test-service-key",
  });
  for (
    const authorization of [
      undefined,
      "Bearer wrong-key",
      "Basic test-service-key",
    ]
  ) {
    const response = await handler(
      new Request("https://example.invalid", {
        method: "POST",
        headers: authorization ? { Authorization: authorization } : {},
      }),
    );
    assertEquals(response.status, 401);
    assertEquals(response.headers.get("Content-Type"), "application/json");
    assertEquals(await response.json(), {
      ok: false,
      error: "unauthenticated",
    });
  }
});

Deno.test("an unscoped call stays closed and never touches the queues", async () => {
  const unreachable = new Proxy({}, {
    get() {
      throw new Error("closed call reached IO");
    },
  });
  const handler = createDispatchHandler({
    db: unreachable as never,
    transport: unreachable as never,
    serviceRoleKey: "test-service-key",
  });
  for (
    const body of [
      undefined,
      {},
      { scope: {} },
      { scope: { event_ids: [] } },
      "not json",
    ]
  ) {
    const response = await handler(
      new Request("https://example.invalid", {
        method: "POST",
        headers: {
          Authorization: "Bearer test-service-key",
          "Content-Type": "application/json",
        },
        body: body === undefined ? null : JSON.stringify(body),
      }),
    );
    assertEquals(response.status, 200);
    assertEquals((await response.json()).closed, true);
  }
});

Deno.test("a valid scope reaches only the durable scoped queue contract", async () => {
  const seen: unknown[] = [];
  const db = {
    deliver: (scope: unknown) => {
      seen.push(scope);
      return Promise.resolve(0);
    },
    claim: (scope: unknown) => {
      seen.push(scope);
      return Promise.resolve([]);
    },
    beginSend: () => {
      throw new Error("no send expected");
    },
    settle: () => {
      throw new Error("no settle expected");
    },
    previews: () => {
      throw new Error("no preview expected");
    },
  };
  const handler = createDispatchHandler({
    db: db as never,
    transport: {} as never,
    serviceRoleKey: "k",
  });
  const response = await handler(
    new Request("https://example.invalid", {
      method: "POST",
      headers: { apikey: "k" },
      body: JSON.stringify({ scope: { event_ids: [20593] } }),
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(seen, [{ eventIds: [20593] }, { eventIds: [20593] }, {
    eventIds: [20593],
  }]);
});

Deno.test("non-POST callers are refused before IO after authentication", async () => {
  const unreachable = new Proxy({}, {
    get() {
      throw new Error("bad method reached IO");
    },
  });
  const handler = createDispatchHandler({
    db: unreachable as never,
    transport: unreachable as never,
    serviceRoleKey: "test-service-key",
  });
  for (const method of ["GET", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await handler(
      new Request("https://example.invalid", {
        method,
        headers: { apikey: "test-service-key" },
      }),
    );
    assertEquals(response.status, 405);
    assertEquals(response.headers.get("Allow"), "POST");
    const unauthorized = await handler(
      new Request("https://example.invalid", { method }),
    );
    assertEquals(unauthorized.status, 401);
  }
});

Deno.test("malformed or partially valid scopes never reach database or provider", async () => {
  const unreachable = new Proxy({}, {
    get() {
      throw new Error("invalid scope reached IO");
    },
  });
  const handler = createDispatchHandler({
    db: unreachable as never,
    transport: unreachable as never,
    serviceRoleKey: "test-service-key",
  });
  const validRecipient = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  for (
    const body of [
      { scope: { event_ids: [1, null], recipient_id: validRecipient } },
      { scope: { event_ids: [1], device_id: "garbage" } },
      { scope: { event_ids: [1], unexpected: true } },
      { scope: { event_ids: [Number.MAX_SAFE_INTEGER + 1] } },
      { scope: { recipient_id: validRecipient, event_ids: [] } },
      { scope: { event_ids: [1] }, mode: "automatic" },
      { scope: { min_event_id: 1 } },
    ]
  ) {
    const response = await handler(
      new Request("https://example.invalid", {
        method: "POST",
        headers: { apikey: "test-service-key" },
        body: JSON.stringify(body),
      }),
    );
    assertEquals(response.status, 200);
    assertEquals((await response.json()).closed, true);
  }
});
