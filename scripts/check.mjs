import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const roots = ["apps", "packages", "scripts"];
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.name.endsWith(".mjs") || entry.name.endsWith(".js")) files.push(fullPath);
  }
}

for (const root of roots) walk(root);
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Syntax OK: ${files.length} files`);
