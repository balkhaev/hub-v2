#!/usr/bin/env node
import readline from "node:readline";
import { createMcpDispatcher } from "./protocol.mjs";

const dispatch = createMcpDispatcher();
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of lines) {
  if (!line.trim()) continue;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })}\n`);
    continue;
  }
  try {
    const response = await dispatch(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    console.error("MCP dispatch failure", error);
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32603, message: "Internal error" } })}\n`);
  }
}
