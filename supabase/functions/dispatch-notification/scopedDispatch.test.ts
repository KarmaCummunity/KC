import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { runScopedDispatch } from "./scopedDispatch.ts";
import { device, pushFor } from "./testKit.ts";
import type {
  DispatchJob,
  ScopedDatabase,
  Settlement,
} from "./scopedDatabase.ts";
import {
  type ProviderMessage,
  type PushTransport,
  TransportError,
} from "./types.ts";
const scope = { eventIds: [1] };
function job(id = 1, platform: "ios" | "android" = "ios"): DispatchJob {
  const d = device(id, platform);
  return {
    id,
    lease_id: "lease-" + id,
    phase: "pending",
    attempts: 1,
    origin_event_id: 1,
    notification_id: "notification",
    recipient_id: "recipient",
    device_id: d.device_id,
    ticket_id: null,
    push: pushFor("follow_started", { tokens: [d] }),
  };
}
function fixture(jobs: DispatchJob[]) {
  const outcomes: Settlement[][] = [];
  const sent: ProviderMessage[][] = [];
  const calls: string[] = [];
  const db: ScopedDatabase = {
    deliver: () => {
      calls.push("deliver");
      return Promise.resolve(0);
    },
    claim: (_s, phase) => {
      calls.push("claim-" + phase);
      return Promise.resolve(phase === "pending" ? jobs : []);
    },
    beginSend: (_s, js) => {
      calls.push("begin");
      return Promise.resolve(new Map(js.map((j) => [j.id, 12])));
    },
    settle: (_s, rs) => {
      calls.push("settle");
      outcomes.push(rs);
      return Promise.resolve();
    },
    previews: () => Promise.resolve(new Map()),
  };
  const transport: PushTransport = {
    send: (ms) => {
      calls.push("post");
      sent.push([...ms]);
      return Promise.resolve(
        ms.map((_, i) => ({ status: "ok", id: "ticket-" + i })),
      );
    },
    getReceipts: () => Promise.resolve({}),
  };
  return { db, transport, outcomes, sent, calls };
}
Deno.test("durable worker: POST only after fenced begin; fresh iOS badge and accepted ticket persisted", async () => {
  const f = fixture([job()]);
  await runScopedDispatch(f.db, f.transport, scope);
  assertEquals(f.calls.indexOf("begin") < f.calls.indexOf("post"), true);
  assertEquals(f.sent[0][0].platform === "ios" && f.sent[0][0].badge, 12);
  assertEquals(f.outcomes[0], [{
    id: 1,
    lease_id: "lease-1",
    state: "accepted",
    ticket_id: "ticket-0",
  }]);
});
Deno.test("durable worker: mixed accepted A and transient B are separate per-device outcomes", async () => {
  const f = fixture([job(1), job(2, "android")]);
  f.transport.send = () =>
    Promise.resolve([{ status: "ok", id: "a" }, {
      status: "error",
      error: "MessageRateExceeded",
    }]);
  await runScopedDispatch(f.db, f.transport, scope);
  assertEquals(f.outcomes[0].map((r) => [r.id, r.state]), [[1, "accepted"], [
    2,
    "retry",
  ]]);
});
Deno.test("durable worker: ambiguous timeout/bad response/ticket mismatch are held, not retried", async () => {
  for (
    const failure of [
      new TransportError("timeout", false, true),
      new Error("unknown"),
    ]
  ) {
    const f = fixture([job()]);
    f.transport.send = () => Promise.reject(failure);
    await runScopedDispatch(f.db, f.transport, scope);
    assertEquals(f.outcomes[0][0].state, "unknown");
  }
  const f = fixture([job()]);
  f.transport.send = () => Promise.resolve([]);
  await runScopedDispatch(f.db, f.transport, scope);
  assertEquals(f.outcomes[0][0].state, "unknown");
});
Deno.test("durable worker: definite HTTP transient retries; permanent/config error stops", async () => {
  for (
    const [retryable, state] of [[true, "retry"], [false, "permanent"]] as const
  ) {
    const f = fixture([job()]);
    f.transport.send = () =>
      Promise.reject(new TransportError("http", retryable));
    await runScopedDispatch(f.db, f.transport, scope);
    assertEquals(f.outcomes[0][0].state, state);
  }
});
Deno.test("durable worker: expired/foreign lease rejects before any provider POST", async () => {
  const f = fixture([job()]);
  f.db.beginSend = () => Promise.reject(new Error("stale lease"));
  await assertRejects(() => runScopedDispatch(f.db, f.transport, scope));
  assertEquals(f.sent.length, 0);
  assertEquals(f.outcomes.length, 0);
});
Deno.test("durable worker: multi-device DB contract violation cannot broaden a job", async () => {
  const j = job();
  j.push = pushFor("follow_started");
  const f = fixture([j]);
  await assertRejects(() => runScopedDispatch(f.db, f.transport, scope));
  assertEquals(f.sent.length, 0);
});
Deno.test("durable worker: missing receipt only polls immutable ticket, never sends again", async () => {
  const f = fixture([]);
  const j = job();
  j.phase = "receipt";
  j.ticket_id = "stored-ticket";
  j.push = null;
  f.db.claim = (_s, phase) => Promise.resolve(phase === "receipt" ? [j] : []);
  let ids: readonly string[] = [];
  f.transport.getReceipts = (x) => {
    ids = x;
    return Promise.resolve({});
  };
  await runScopedDispatch(f.db, f.transport, scope);
  assertEquals(ids, ["stored-ticket"]);
  assertEquals(f.outcomes[0][0].state, "receipt_pending");
  assertEquals(f.sent.length, 0);
});
Deno.test("durable worker: settlement failure after POST is not followed by a second POST", async () => {
  const f = fixture([job()]);
  f.db.settle = () => Promise.reject(new Error("db unavailable"));
  await assertRejects(() => runScopedDispatch(f.db, f.transport, scope));
  assertEquals(f.sent.length, 1);
});
