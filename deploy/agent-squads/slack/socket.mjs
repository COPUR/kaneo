// Slack Socket Mode with Node's built-in WebSocket: no public URL and no
// dependencies. Slack sends events over the socket; each envelope is
// acknowledged at once and handled after, so slow Kaneo calls cause no
// redelivery. Reconnects when Slack asks or the socket drops.

import { apiBase } from "./api.mjs";

export async function listen(appToken, onEvent, { log = console.log } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      const url = await openConnection(appToken);
      attempt = 0;
      await runSocket(url, onEvent, log);
      log("socket closed, reconnecting");
    } catch (error) {
      attempt++;
      const wait = Math.min(60, 2 ** attempt);
      log(`socket error: ${error.message}; retry in ${wait}s`);
      await new Promise((done) => setTimeout(done, wait * 1000));
    }
  }
}

async function openConnection(appToken) {
  const res = await fetch(`${apiBase()}/apps.connections.open`, {
    method: "POST",
    headers: { authorization: `Bearer ${appToken}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`apps.connections.open: ${data.error}`);
  return data.url;
}

function runSocket(url, onEvent, log) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("message", ({ data }) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }
      if (msg.envelope_id)
        ws.send(JSON.stringify({ envelope_id: msg.envelope_id }));
      if (msg.type === "hello") log("connected to Slack");
      if (msg.type === "disconnect") ws.close();
      if (msg.type === "events_api") {
        Promise.resolve(onEvent(msg.payload)).catch((error) =>
          log(`event failed: ${error.message}`),
        );
      }
    });
    ws.addEventListener("close", () => resolve());
    ws.addEventListener("error", (event) =>
      reject(new Error(event.message ?? "websocket error")),
    );
  });
}
