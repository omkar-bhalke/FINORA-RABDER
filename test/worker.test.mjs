import test from "node:test";
import assert from "node:assert/strict";
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
test(
  "worker enforces verified consent and concurrent delivery idempotency",
  { skip: !emulator },
  async () => {
    assert.match(emulator, /^(127\.0\.0\.1|localhost):\d+$/);
    Object.assign(process.env, {
      FINORA_WORKER_MODE: "test",
      META_GRAPH_VERSION: "v22.0",
      META_PHONE_NUMBER_ID: "test",
      META_ACCESS_TOKEN: "fixture",
      META_TEMPLATE: "fixture",
    });
    const { db } = await import("../dist/firebase.js");
    const { send } = await import("../dist/worker.js");
    const user = db.doc("users/test-" + Date.now()),
      pref = user.collection("reportPreferences").doc("daily");
    const period = Date.parse("2026-11-25T15:30:00Z");
    const recipient = "+910000000000";
    await pref.set({
      recipient,
      zone: "Asia/Kolkata",
      time: "21:00",
      enabled: true,
      consent: true,
    });
    await user
      .collection("transactions")
      .doc("one")
      .set({ time: period - 1, amount: 100, credit: false });
    const permit = user.collection("integrations").doc("recipient");
    const snapshot = await pref.get();
    let sends = 0;
    const fake = async (url, options) => {
      sends++;
      const message = JSON.parse(options.body);
      assert.equal(message.to, recipient.slice(1));
      assert.equal(message.template.components[0].parameters[3].text, "1");
      return Response.json({ messages: [{ id: "test-" + user.id }] });
    };
    try {
      await send(snapshot, period, fake);
      assert.equal(sends, 0);
      await permit.set({ recipient, verified: true, productionApproved: true });
      await Promise.all([
        send(snapshot, period, fake),
        send(snapshot, period, fake),
      ]);
      assert.equal(sends, 1);
      assert.equal(
        (await user.collection("reportHistory").doc("2026-11-25").get()).get(
          "state",
        ),
        "accepted",
      );
      if (process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
        assert.match(
          process.env.FIREBASE_DATABASE_EMULATOR_HOST,
          /^127[.]0[.]0[.]1:\d+$/,
        );
        const { flushActivity, activityDb } = await import(
          "../dist/activity.js"
        );
        await flushActivity();
        const target = activityDb().ref(
          "reportActivity/" + user.id + "/2026-11-25",
        );
        const logged = (await target.once("value")).val();
        assert.equal(logged.state, "accepted");
        assert.equal(logged.statement.expenses, 100);
        assert.equal(logged.statement.parameters[3], "1");
        assert.deepEqual(
          logged.events.map((e) => e.kind),
          ["generated", "send_attempt", "accepted"],
        );
        assert.equal(logged.zone, "Asia/Kolkata");
        assert.equal(logged.scheduledAt, period);
        assert.ok(
          logged.generatedAt > 0 && logged.acceptedAt >= logged.generatedAt,
        );
        assert.equal(logged.recipient, undefined);
        const hist = user.collection("reportHistory").doc("2026-11-25");
        await hist.update({
          logPending: true,
          delivery: "delivered",
          deliveryAt: Date.now(),
        });
        await flushActivity();
        assert.equal(
          (await target.once("value")).child("delivery").val(),
          "delivered",
        );
        await target.remove();
        await activityDb().goOffline();
      }
      await pref.update({ consent: false });
      await send(await pref.get(), period + 86400000, fake);
      assert.equal(sends, 1);
    } finally {
      await db.recursiveDelete(user);
      await db
        .collection("outboundMessages")
        .doc("test-" + user.id)
        .delete();
      await db.terminate();
    }
  },
);
