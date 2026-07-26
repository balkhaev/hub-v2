import test from "node:test";
import assert from "node:assert/strict";
import { createMcpDispatcher } from "../src/protocol.mjs";

test("MCP exposes short drama tools and calls Hub", async () => {
  const calls = [];
  const client = {
    async createShortDrama(input) { calls.push(input); return { creativeJob: { id: "cjob_1" } }; },
    async getShortDrama() {}, async reconcileShortDrama() {}, async listPersonas() { return { items: [] }; },
  };
  const dispatch = createMcpDispatcher({ client });
  const initialized = await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(initialized.result.serverInfo.name, "luv-hub");
  const list = await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.ok(list.result.tools.some((tool) => tool.name === "hub_create_short_drama"));
  const call = await dispatch({
    jsonrpc: "2.0", id: 3, method: "tools/call",
    params: { name: "hub_create_short_drama", arguments: { premise: "a dramatic call" } },
  });
  assert.equal(call.result.isError, false);
  assert.equal(calls[0].premise, "a dramatic call");
});

test("MCP reports Hub failures as tool execution errors", async () => {
  const client = { async createShortDrama() { const error = new Error("Hub unavailable"); error.code = "offline"; throw error; } };
  const dispatch = createMcpDispatcher({ client });
  const result = await dispatch({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "hub_create_short_drama", arguments: { premise: "x" } } });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /offline/);
});
