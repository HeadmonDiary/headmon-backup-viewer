import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;
const previewRoot = new URL("../app/_sites-preview/", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the private backup viewer", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.match(html, /<title>Backup viewer \| Headmon<\/title>/i);
  assert.match(html, /aria-label="Primary navigation"/i);
  assert.match(html, /© 2026 Headmon/);
  assert.match(html, /See what your diary remembers\./);
  assert.match(html, /browse, repair, compare, and report on your diary/i);
  assert.match(html, /never uploads or saves it in browser storage\./);
  assert.match(html, /No persistent browser storage/);
  assert.match(html, /complete ZIP or calendar JSON backup/i);
  assert.match(html, /Choose backup/);
});

test("removes the temporary starter preview", async () => {
  await assert.rejects(access(previewRoot));
});
