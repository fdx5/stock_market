import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const directory = await mkdtemp(join(tmpdir(), "admin-devices-test-"));
try {
  const output = join(directory, "tests.cjs");
  await build({ entryPoints: ["tests/admin-devices.test.tsx"], outfile: output, bundle: true, platform: "node", format: "cjs", jsx: "automatic", loader: { ".css": "empty" } });
  const result = spawnSync(process.execPath, ["--test", output], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
