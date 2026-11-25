import { flushActivity } from "./activity.js";
import { db, need } from "./firebase.js";
import { dueSlot, summarize, rupees, details } from "./report.js";
import { DateTime } from "luxon";
import {
  FieldPath,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { setTimeout as delay } from "node:timers/promises";

export async function send(
  pref: QueryDocumentSnapshot,
  now: number,
  transport: typeof fetch = fetch,
) {
  if (pref.id !== "daily") return;
  const user = pref.ref.parent.parent;
  if (!user || user.parent.path !== "users") return;
  const p = pref.data();
  if (!p.consent || !p.enabled) return;
  const slot = dueSlot(now, p.zone, p.time);
  if (!slot) return;
  const history = user.collection("reportHistory").doc(slot.day);
  const permit = user.collection("integrations").doc("recipient");
  const version = need("META_GRAPH_VERSION"),
    token = need("META_ACCESS_TOKEN"),
    phoneId = need("META_PHONE_NUMBER_ID"),
    template = need("META_TEMPLATE");
  const fields = Array.isArray(p.fields)
    ? p.fields.filter((f: unknown) =>
        ["balances", "categories", "budget", "transactions"].includes(
          String(f),
        ),
      )
    : [];
  const detailTemplate = fields.length
    ? need("META_DETAIL_TEMPLATE")
    : undefined;
  const existing = (await history.get()).data();
  if (
    existing &&
    (existing.state !== "retryable" ||
      existing.retryAt > now ||
      existing.attempts >= 3)
  )
    return;
  const eligibility = (await permit.get()).data();
  if (
    eligibility?.productionApproved !== true ||
    eligibility?.verified !== true ||
    eligibility.recipient !== p.recipient
  )
    return;
  const rows = await user
    .collection("transactions")
    .where("time", ">=", slot.start)
    .where("time", "<", slot.end)
    .get();
  const summary = summarize(rows.docs.map((d) => d.data()));
  const period = [slot.start, slot.end]
    .map((t) =>
      DateTime.fromMillis(t, { zone: p.zone }).toFormat(
        "dd LLL yyyy HH:mm ZZZZ",
      ),
    )
    .join(" – ");
  const parameters = [
    period,
    rupees(summary.income),
    rupees(summary.expenses),
    String(summary.count),
  ];
  if (detailTemplate) {
    const previous = fields.includes("balances")
      ? await user
          .collection("transactions")
          .where("time", "<", slot.start)
          .get()
      : null;
    parameters.push(
      details(
        rows.docs.map((d) => d.data()),
        (await user.get()).data() ?? {},
        previous?.docs.map((d) => d.data()) ?? [],
        p.zone,
        fields,
      ),
    );
  }
  const payload = {
    messaging_product: "whatsapp",
    to: p.recipient.slice(1),
    type: "template",
    template: {
      name: detailTemplate || template,
      language: { code: process.env.META_TEMPLATE_LANGUAGE || "en" },
      components: [
        {
          type: "body",
          parameters: parameters.map((text) => ({ type: "text", text })),
        },
      ],
    },
  };
  const claim = await db.runTransaction(async (t) => {
    const [previous, latest, verified] = await t.getAll(
      history,
      pref.ref,
      permit,
    );
    const current = latest.data(),
      v = verified.data(),
      h = previous.data();
    if (
      !current?.enabled ||
      !current.consent ||
      current.recipient !== p.recipient ||
      current.zone !== p.zone ||
      current.time !== p.time ||
      JSON.stringify(current.fields ?? []) !== JSON.stringify(p.fields ?? [])
    )
      return false;
    // Only trusted operations may approve a production account. Test accounts have no permit.
    if (
      v?.productionApproved !== true ||
      v?.verified !== true ||
      v?.recipient !== current.recipient
    )
      return false;
    if (h && (h.state !== "retryable" || h.retryAt > now || h.attempts >= 3))
      return false;
    t.set(history, {
      state: "sending",
      generatedAt: Date.now(),
      zone: p.zone,
      logPending: true,
      start: slot.start,
      end: slot.end,
      attempts: (h?.attempts ?? 0) + 1,
      updatedAt: now,
    });
    return true;
  });
  if (!claim) return;
  try {
    const response = await transport(
      "https://graph.facebook.com/" + version + "/" + phoneId + "/messages",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok) {
      const state =
        response.status === 429
          ? "retryable"
          : response.status >= 500
            ? "unknown"
            : "rejected";
      await history.update({
        state,
        httpStatus: response.status,
        logPending: true,
        updatedAt: Date.now(),
        retryAt: Date.now() + 120000,
      });
      return;
    }
    const message = (await response.json()).messages?.[0]?.id;
    if (!message) throw Error("No acknowledgment");
    const batch = db.batch();
    batch.update(history, {
      state: "accepted",
      acceptedAt: Date.now(),
      logPending: true,
      message,
      updatedAt: Date.now(),
    });
    batch.set(db.collection("outboundMessages").doc(message), {
      path: history.path,
    });
    await batch.commit();
  } catch {
    await history.update({
      state: "unknown",
      logPending: true,
      updatedAt: Date.now(),
    });
  }
}
async function tick() {
  if (process.env.LIVE_REPORTS !== "true") return;
  const base = db
    .collectionGroup("reportPreferences")
    .where("enabled", "==", true)
    .orderBy(FieldPath.documentId())
    .limit(100);
  let cursor: QueryDocumentSnapshot | undefined;
  for (;;) {
    const page = await (cursor ? base.startAfter(cursor) : base).get();
    for (const doc of page.docs) {
      try {
        await send(doc, Date.now());
      } catch {
        console.error("report_processing_failed");
      }
    }
    if (page.size < 100) return;
    cursor = page.docs[page.size - 1];
  }
}
if (process.env.FINORA_WORKER_MODE !== "test")
  for (;;) {
    try {
      await tick();
    } catch {
      console.error("scheduler_tick_failed");
    }
    try {
      await flushActivity();
    } catch {
      console.error("report_log_sync_failed");
    }
    await delay(30000);
  }
