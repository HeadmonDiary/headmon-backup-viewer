import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const outputRoot = path.resolve("static-dist");

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(target)));
    else if (entry.isFile()) files.push(target);
  }

  return files;
}

for (const file of (await collectFiles(outputRoot)).sort()) {
  const digest = createHash("sha256").update(await readFile(file)).digest("hex");
  console.log(`${digest}  ${path.relative(outputRoot, file)}`);
}
