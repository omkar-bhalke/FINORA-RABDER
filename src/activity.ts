import { getDatabaseWithUrl } from "firebase-admin/database";
import { FieldPath } from "firebase-admin/firestore";
import { db, need } from "./firebase.js";

export function activityDb() {
  return getDatabaseWithUrl(need("FIREBASE_DATABASE_URL"));
}

// Commit the report and its pending flag together in Firestore. Only acknowledge
// the projection if no new webhook or send attempt changed the source document.
export async function flushActivity() {
  const page = await db
    .collectionGroup("reportHistory")
    .where("logPending", "==", true)
    .orderBy(FieldPath.documentId())
    .limit(100)
    .get();
  for (const doc of page.docs) {
    const user = doc.ref.parent.parent;
    if (!user || user.parent.path !== "users") continue;
    const d = doc.data();
    const rev =
      String(doc.updateTime.seconds).padStart(12, "0") +
      String(doc.updateTime.nanoseconds).padStart(9, "0");
    const row = {
      rev,
      statement: d.statement ?? null,
      events: d.events ?? null,
      scheduledAt: d.end,
      generatedAt: d.generatedAt ?? null,
      acceptedAt: d.acceptedAt ?? null,
      periodStart: d.start,
      periodEnd: d.end,
      zone: d.zone ?? "UTC",
      attempts: d.attempts,
      state: d.state,
      delivery: d.delivery ?? null,
      deliveryAt: d.deliveryAt ?? null,
      updatedAt: d.updatedAt,
    };
    const target = activityDb().ref("reportActivity/" + user.id + "/" + doc.id);
    await target.transaction((prev) =>
      prev && prev.rev >= rev ? undefined : row,
    );
    await db.runTransaction(async (t) => {
      const latest = await t.get(doc.ref);
      if (latest.updateTime?.isEqual(doc.updateTime))
        t.update(doc.ref, { logPending: false });
    });
  }
}
