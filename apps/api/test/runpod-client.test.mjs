import test from "node:test";
import assert from "node:assert/strict";
import { RunpodClient } from "../src/runpod-client.mjs";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("Runpod client submits async jobs with bearer authorization", async () => {
  let request;
  const client = new RunpodClient({
    apiKey: "secret",
    endpointId: "endpoint-1",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response({ id: "rp-1", status: "IN_QUEUE" });
    },
  });
  const result = await client.submit({ prompt: "hello" });
  assert.equal(result.id, "rp-1");
  assert.equal(request.url, "https://api.runpod.ai/v2/endpoint-1/run");
  assert.equal(request.options.headers.authorization, "Bearer secret");
});

test("Runpod client does not duplicate an existing Bearer prefix", async () => {
  let authorization;
  const client = new RunpodClient({
    apiKey: "Bearer secret",
    endpointId: "endpoint-1",
    fetchImpl: async (_url, options) => {
      authorization = options.headers.authorization;
      return response({ id: "rp-2", status: "IN_QUEUE" });
    },
  });
  await client.submit({ prompt: "hello" });
  assert.equal(authorization, "Bearer secret");
});
