import { activityDb } from "./activity.js";
import express from "express";
import { getStorage } from "firebase-admin/storage";
import rateLimit from "express-rate-limit";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { db, auth, appCheck, need } from "./firebase.js";
import { summarize, details } from "./report.js";
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === need("META_VERIFY_TOKEN")
  )
    res.type("text").send(req.query["hub.challenge"]);
  else res.sendStatus(403);
});
app.post(
  "/webhook",
  express.raw({ type: "application/json", limit: "128kb" }),
  async (req, res) => {
    const expected = Buffer.from(
      "sha256=" +
        createHmac("sha256", need("META_APP_SECRET"))
          .update(req.body)
          .digest("hex"),
    );
    const actual = Buffer.from(req.get("x-hub-signature-256") || "");
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      res.sendStatus(403);
      return;
    }
    const event = JSON.parse(req.body.toString());
    for (const entry of event.entry ?? [])
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (value?.metadata?.phone_number_id !== need("META_PHONE_NUMBER_ID"))
          continue;
        for (const msg of value.messages ?? []) {
          const match = /^FINORA ([a-f0-9]{32})$/i.exec(msg.text?.body ?? "");
          if (!match) continue;
          const challenge = db
            .collection("recipientChallenges")
            .doc(hash(match[1]));
          await db.runTransaction(async (t) => {
            const c = (await t.get(challenge)).data();
            if (!c || c.expires < Date.now() || c.recipient !== "+" + msg.from)
              return;
            const ref = db.doc("users/" + c.uid + "/integrations/recipient");
            const pref = (
              await t.get(db.doc("users/" + c.uid + "/reportPreferences/daily"))
            ).data();
            if (!pref?.consent || pref.recipient !== c.recipient) return;
            t.set(
              ref,
              {
                recipient: c.recipient,
                verified: true,
                verifiedAt: Date.now(),
              },
              { merge: true },
            );
            t.delete(challenge);
          });
        }
        for (const status of value.statuses ?? []) {
          if (!["sent", "delivered", "read", "failed"].includes(status.status))
            continue;
          const mapping = await db
            .collection("outboundMessages")
            .doc(status.id)
            .get();
          if (!mapping.exists) {
            res.sendStatus(503);
            return;
          }
          const report = db.doc(mapping.get("path"));
          await db.runTransaction(async (t) => {
            const prev = (await t.get(report)).data();
            const ranks: Record<string, number> = {
              sent: 1,
              failed: 2,
              delivered: 3,
              read: 4,
            };
            if (prev && (ranks[prev.delivery] ?? 0) < ranks[status.status])
              t.update(report, {
                delivery: status.status,
                logPending: true,
                updatedAt: Date.now(),
                deliveryAt: Number(status.timestamp) * 1000,
              });
          });
        }
      }
    res.sendStatus(200);
  },
);
app.use(
  "/v1",
  rateLimit({ windowMs: 60000, limit: 60 }),
  async (req, res, next) => {
    try {
      const id = await auth.verifyIdToken(
        (req.get("authorization") || "").replace(/^Bearer /, ""),
        true,
      );
      await appCheck.verifyToken(req.get("X-Firebase-AppCheck") || "");
      res.locals.uid = id.uid;
      res.locals.authTime = id.auth_time;
      next();
    } catch {
      res.sendStatus(401);
    }
  },
);
app.get("/v1/preview", async (_req, res) => {
  const end = Date.now(),
    start = end - 86400000;
  const rows = await db
    .collection("users/" + res.locals.uid + "/transactions")
    .where("time", ">=", start)
    .where("time", "<", end)
    .get();
  const user = db.doc("users/" + res.locals.uid);
  const pref = (
    await user.collection("reportPreferences").doc("daily").get()
  ).data();
  const fields = Array.isArray(pref?.fields) ? pref.fields : [];
  const entries = rows.docs.map((d) => d.data());
  const prior = fields.includes("balances")
    ? await user.collection("transactions").where("time", "<", start).get()
    : null;
  const extra = fields.length
    ? details(
        entries,
        (await user.get()).data() ?? {},
        prior?.docs.map((d) => d.data()) ?? [],
        pref?.zone ?? "UTC",
        fields,
      )
    : null;
  res.json({ start, end, ...summarize(entries), extra });
});
app.post("/v1/recipient-challenge", async (_req, res) => {
  const uid = res.locals.uid;
  const pref = (
    await db.doc("users/" + uid + "/reportPreferences/daily").get()
  ).data();
  if (!pref?.consent) {
    res.sendStatus(409);
    return;
  }
  const code = randomBytes(16).toString("hex");
  await db
    .collection("recipientChallenges")
    .doc(hash(code))
    .set({ uid, recipient: pref.recipient, expires: Date.now() + 600000 });
  res.json({
    text: "FINORA " + code,
    businessNumber: need("META_BUSINESS_NUMBER"),
  });
});
app.get("/v1/status", async (_req, res) => {
  const user = db.doc("users/" + res.locals.uid);
  const [verified, pref, history] = await Promise.all([
    user.collection("integrations").doc("recipient").get(),
    user.collection("reportPreferences").doc("daily").get(),
    user.collection("reportHistory").orderBy("end", "desc").limit(20).get(),
  ]);
  res.json({
    verified:
      verified.get("verified") === true &&
      verified.get("recipient") === pref.get("recipient"),
    enabled: process.env.LIVE_REPORTS === "true",
    history: history.docs.map((d) => d.data()),
  });
});
app.delete("/v1/account", async (req, res) => {
  if (Date.now() / 1000 - res.locals.authTime > 300) {
    res.status(403).json({ error: "Sign in again to delete the account" });
    return;
  }
  const uid = res.locals.uid,
    user = db.doc("users/" + uid);
  const bucket = need("FIREBASE_STORAGE_BUCKET");
  await getStorage()
    .bucket(bucket)
    .file("users/" + uid + "/avatar.jpg")
    .delete({ ignoreNotFound: true });
  const reports = await user.collection("reportHistory").get();
  for (const report of reports.docs) {
    const id = report.get("message");
    if (typeof id === "string")
      await db.collection("outboundMessages").doc(id).delete();
  }
  await db.recursiveDelete(user);
  await activityDb()
    .ref("reportActivity/" + uid)
    .remove();
  const challenges = await db
    .collection("recipientChallenges")
    .where("uid", "==", uid)
    .get();
  for (const doc of challenges.docs) await doc.ref.delete();
  await auth.deleteUser(uid);
  res.sendStatus(204);
});
app.use(((err, req, res, next) => {
  console.error("request_failed");
  res.sendStatus(500);
}) as express.ErrorRequestHandler);
app.listen(Number(process.env.PORT || 3000));
