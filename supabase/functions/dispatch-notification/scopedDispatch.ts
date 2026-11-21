// Durable, fenced per-device delivery. Ambiguous POSTs are held, not automatically
// resent. A provider receipt is evidence of provider acceptance, not physical display.
import { buildMessages, PayloadError, previewMessageId } from "./messages.ts";
import {
  type ProviderMessage,
  type PushTransport,
  TransportError,
} from "./types.ts";
import type {
  DispatchJob,
  ScopedDatabase,
  Settlement,
  WorkerScope,
} from "./scopedDatabase.ts";
export interface ScopedSummary {
  events: number;
  claimed: number;
  accepted: number;
  unknown: number;
  failed: number;
  receipts: number;
}
function result(
  j: DispatchJob,
  state: Settlement["state"],
  ticket_id?: string,
): Settlement {
  return {
    id: j.id,
    lease_id: j.lease_id,
    state,
    ...(ticket_id ? { ticket_id } : {}),
  };
}
export async function runScopedDispatch(
  db: ScopedDatabase,
  transport: PushTransport,
  scope: WorkerScope,
): Promise<ScopedSummary> {
  const summary: ScopedSummary = {
    events: 0,
    claimed: 0,
    accepted: 0,
    unknown: 0,
    failed: 0,
    receipts: 0,
  };
  const receipts = await db.claim(scope, "receipt", 100);
  if (receipts.length) {
    let answers: Awaited<ReturnType<PushTransport["getReceipts"]>> = {};
    try {
      answers = await transport.getReceipts(receipts.map((j) => j.ticket_id!));
    } catch { /* poll stored ticket later, never resend */ }
    await db.settle(
      scope,
      receipts.map((j) => {
        const ticket = answers[j.ticket_id!];
        summary.receipts++;
        return result(
          j,
          !ticket
            ? "receipt_pending"
            : ticket.status === "ok"
            ? "provider_accepted"
            : ticket.error === "DeviceNotRegistered"
            ? "device_gone"
            : "permanent",
        );
      }),
    );
  }
  summary.events = await db.deliver(scope, 100);
  const jobs = await db.claim(scope, "pending", 100);
  summary.claimed = jobs.length;
  if (!jobs.length) return summary;
  const previewIds = [
    ...new Set(
      jobs.map((j) => j.push && previewMessageId(j.push)).filter((
        id,
      ): id is string => typeof id === "string"),
    ),
  ];
  const previews = previewIds.length
    ? await db.previews(previewIds)
    : new Map<string, string | null>();
  const valid: DispatchJob[] = [];
  const messages: ProviderMessage[] = [];
  const rejected: Settlement[] = [];
  // Each durable job is exactly one native device. Refuse a DB contract violation
  // before granting POST permission, rather than sending an accidental wider payload.
  for (const job of jobs) {
    try {
      if (
        !job.push || job.push.tokens.length !== 1 ||
        job.push.tokens[0].device_id !== job.device_id
      ) {
        throw new Error("dispatch device contract");
      }
      const built = buildMessages(
        job.push,
        previews.get(previewMessageId(job.push) ?? ""),
      );
      if (built.length !== 1 || built[0].deviceId !== job.device_id) {
        throw new Error("dispatch device contract");
      }
      valid.push(job);
      messages.push(built[0].message);
    } catch (error) {
      // Claim stays pending and fenced, no provider call. A malformed DB contract must
      // stop, not silently mark other devices done. Rendering errors are held for review.
      if (error instanceof PayloadError) {
        rejected.push(result(job, "permanent"));
        summary.failed++;
      } else throw error;
    }
  }
  if (rejected.length) await db.settle(scope, rejected);
  if (!valid.length) return summary;
  const badges = await db.beginSend(scope, valid); // ownership/token/eligibility/epoch and fresh badge, immediately before POST
  for (let i = 0; i < messages.length; i++) {
    if (!badges.has(valid[i].id)) {
      throw new Error("dispatch begin-send contract");
    }
    const message = messages[i];
    if (message.platform === "ios") {
      messages[i] = { ...message, badge: badges.get(valid[i].id)! };
    }
  }
  let settlements: Settlement[];
  try {
    const tickets = await transport.send(messages);
    if (tickets.length !== valid.length) {
      throw new TransportError("ticket_mismatch", false, true);
    }
    settlements = valid.map((job, i) => {
      const ticket = tickets[i];
      if (ticket.status === "ok" && ticket.id) {
        summary.accepted++;
        return result(job, "accepted", ticket.id);
      }
      if (ticket.error === "DeviceNotRegistered") {
        return result(job, "device_gone");
      }
      if (ticket.error === "MessageRateExceeded") return result(job, "retry");
      if (
        !ticket.error || ticket.error === "unknown_error" ||
        ticket.status === "ok"
      ) {
        summary.unknown++;
        return result(job, "unknown");
      }
      summary.failed++;
      return result(job, "permanent");
    });
  } catch (error) {
    const state = error instanceof TransportError && !error.ambiguous
      ? (error.retryable ? "retry" : "permanent")
      : "unknown";
    if (state === "unknown") summary.unknown += valid.length;
    if (state === "permanent") summary.failed += valid.length;
    settlements = valid.map((j) => result(j, state));
  }
  await db.settle(scope, settlements); // if this fails after POST, expired sending lease becomes send_unknown, never re-POSTed
  return summary;
}
