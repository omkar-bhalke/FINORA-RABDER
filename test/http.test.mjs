import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { once } from "node:events";

test("HTTP service verifies Meta callbacks and protects private previews", async () => {
  const port = "32973";
  const base = "http://127.0.0.1:" + port;
  const server = spawn(process.execPath, ["dist/server.js"], {
    stdio: "ignore",
    env: {
      ...process.env,
      PORT: port,
      META_VERIFY_TOKEN: "unit-test-challenge",
      META_APP_SECRET: "unit-test-secret",
      META_PHONE_NUMBER_ID: "fixture",
      LIVE_REPORTS: "false",
    },
  });
  try {
    let healthy = false;
    for (let i = 0; i < 80; i++) {
      try {
        healthy =
          (await (await fetch(base + "/health")).json()).status === "ok";
      } catch {}
      if (healthy) break;
      await delay(100);
    }
    assert.equal(healthy, true);
    assert.equal((await fetch(base + "/v1/preview")).status, 401);
    assert.equal(
      (await fetch(base + "/webhook?hub.mode=subscribe&hub.verify_token=wrong"))
        .status,
      403,
    );
    const probe = await fetch(
      base +
        "/webhook?hub.mode=subscribe&hub.verify_token=unit-test-challenge&hub.challenge=hello",
    );
    assert.equal(await probe.text(), "hello");
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [],
    });
    const send = (signature) =>
      fetch(base + "/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hub-Signature-256": signature,
        },
        body,
      });
    assert.equal((await send("invalid")).status, 403);
    assert.equal(
      (
        await send(
          "sha256=" +
            createHmac("sha256", "unit-test-secret").update(body).digest("hex"),
        )
      ).status,
      200,
    );
  } finally {
    if (server.exitCode === null) {
      const stopped = once(server, "exit");
      server.kill();
      await stopped;
    }
  }
});
