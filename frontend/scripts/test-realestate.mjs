import { build } from "esbuild";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "realestate-test-"));
const output = join(directory, "tests.cjs");
try {
  await build({ entryPoints: ["tests/realestate.test.tsx"], outfile: output, bundle: true, platform: "node", format: "cjs", jsx: "automatic" });
  const result = spawnSync(process.execPath, ["--test", output], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await unlink(output).catch(() => {});
  await rmdir(directory).catch(() => {});
}
