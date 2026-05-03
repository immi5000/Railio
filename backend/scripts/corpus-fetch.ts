import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";

type Source = {
  kind: "ecfr-xml" | "pdf";
  url: string;
  out_filename: string;
  doc_class: string;
  doc_id: string;
  doc_title: string;
};

const here = path.resolve(__dirname, "..");
const manifestPath = path.join(here, "corpus-sources", "sources.json");
const rawDir = path.join(here, "corpus-sources", "raw");

const force = process.argv.includes("--force");

(async () => {
  const sources: Source[] = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  await fs.mkdir(rawDir, { recursive: true });

  for (const s of sources) {
    const out = path.join(rawDir, s.out_filename);
    let exists = false;
    try {
      const st = await fs.stat(out);
      exists = st.size > 0;
    } catch {}
    if (exists && !force) {
      console.log(`skip  ${s.out_filename} (exists; --force to refetch)`);
      continue;
    }
    process.stdout.write(`fetch ${s.out_filename} … `);
    const r = await fetch(s.url, {
      headers: { Accept: s.kind === "ecfr-xml" ? "application/xml" : "application/pdf" },
    });
    if (!r.ok) {
      console.log(`FAILED (${r.status} ${r.statusText})`);
      console.error(`  url: ${s.url}`);
      process.exitCode = 1;
      continue;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    await fs.writeFile(out, buf);
    console.log(`ok (${(buf.length / 1024).toFixed(0)} KB)`);
  }

  console.log("corpus-fetch: done.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
