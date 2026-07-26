import test from "node:test";
import assert from "node:assert/strict";
import { RunpodClient } from "../src/runpod-client.mjs";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("Runpod client submits async jobs to queue endpoint", async () => {
  let request;
  const client = new RunpodClient({
    apiKey: "secret",
    endpointId: "endpoint-1",
    fetchImpl: async (url, options) => { request = { url, options }; return response({ id: "rp-1", status: "IN_QUEUE" }); },
  });
  const result = await client.submit({ prompt: "hello" });
  assert.equal(result.id, "rp-1");
  assert.equal(request.url, "https://api.runpod.ai/v2/endpoint-1/run");
  assert.equal(request.options.headers.authorization, "secret");
});
