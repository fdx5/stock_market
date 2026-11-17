// Isolated native-resolution renderer benchmark; no app startup or saved data.
const options = new URLSearchParams(location.search);
const kind = options.get("kind") ?? "nanotube";
const baseline = options.has("baseline");
const level = (options.get("level") ?? "balanced") as "balanced" | "full" | "minimal";
const canvas = document.querySelector("canvas")!;
if (options.has("worker")) {
  import("../src/neo/backdropInstaller").then(({ installBackdrop }) => {
    const stop = installBackdrop(canvas, kind as "nanotube" | "silk", level,
      () => { canvas.dataset.failed = "true"; }, () => location.reload());
    Object.assign(window, { stopBackdrop: stop, benchmarkReady: true });
  });
} else {
const modules = baseline
  ? import(/* @vite-ignore */ `/qa-backdrops/baseline/neo/${kind === "silk" ? "silkFlowRenderer" : "nanotubeRenderer"}.ts`)
  : kind === "silk" ? import("../src/neo/silkFlowRenderer") : import("../src/neo/nanotubeRenderer");
modules.then(module => {
  const install = "installSilkFlow" in module ? module.installSilkFlow : module.installNanotubes;
  const stop = install(canvas, level, () => { canvas.dataset.failed = "true"; }, () => location.reload());
  Object.assign(window, { stopBackdrop: stop, benchmarkReady: true });
});
}
