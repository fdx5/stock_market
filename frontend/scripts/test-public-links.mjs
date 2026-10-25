import { build } from "esbuild";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const output = join(await mkdtemp(join(tmpdir(), "public-links-test-")), "tests.cjs");
await build({ entryPoints: ["tests/public-links.test.ts"], outfile: output, bundle: true, platform: "node", format: "cjs" });
process.exitCode = spawnSync(process.execPath, ["--test", output], { stdio: "inherit" }).status ?? 1;
