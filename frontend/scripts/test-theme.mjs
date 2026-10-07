import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../src/theme.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const bootstrap = readFileSync(new URL("../index.html", import.meta.url), "utf8").match(/<script>([\s\S]*?)<\/script>/)[1];

function runtime({ path = "/desk", stored = null, blockedRead = false, blockedWrite = false } = {}) {
  const data = new Map(stored === null ? [] : [["site_theme", stored]]);
  const attrs = new Map();
  const events = new Map();
  const localStorage = {
    getItem(key) { if (blockedRead) throw new Error("blocked"); return data.get(key) ?? null; },
    setItem(key, value) { if (blockedWrite) throw new Error("full"); data.set(key, value); },
  };
  const document = {
    documentElement: { setAttribute: (key, value) => attrs.set(key, value), classList: { add() {} } },
    querySelector: () => ({ setAttribute: (key, value) => attrs.set("meta:" + key, value) }),
  };
  const location = { pathname: path };
  const window = { location, localStorage, addEventListener: (key, callback) => events.set(key, callback) };
  const context = vm.createContext({ window, document, localStorage, location, exports: {}, require: () => ({ useSyncExternalStore() {} }) });
  vm.runInContext(bootstrap, context);
  const firstPaint = attrs.get("data-theme");
  vm.runInContext(source, context);
  return { api: context.exports, data, attrs, events, firstPaint, localStorage };
}

test("explicitly selecting the visible default persists it across pages", () => {
  const r = runtime();
  r.api.setThemeMode("light");
  assert.equal(r.data.get("site_theme"), "light");
  for (const path of ["/global", "/map", "/stock/AAPL", "/support", "/admin", "/"]) {
    r.api.syncThemeForPath(path);
    assert.equal(r.api.getThemeMode(), "light");
    assert.equal(r.attrs.get("data-theme"), "light");
  }
});

test("stored choices win over every route default in both editions", () => {
  for (const stored of ["dark", "light"]) {
    const r = runtime({ stored });
    for (const path of ["/desk", "/realestate-map", "/support", "/global", "/stock/005930"]) {
      r.api.syncThemeForPath(path);
      assert.equal(r.api.getThemeMode(), stored);
    }
  }
});

test("storage updates notify charts and apply DOM and browser chrome together", () => {
  const r = runtime({ stored: "dark" });
  let notifications = 0;
  r.api.watchTheme(() => notifications++);
  r.data.set("site_theme", "light");
  r.events.get("storage")({ key: "site_theme", storageArea: r.localStorage });
  assert.equal(r.api.getThemeMode(), "light");
  assert.equal(r.attrs.get("data-theme"), "light");
  assert.equal(r.attrs.get("meta:content"), "#eae7df");
  assert.equal(notifications, 1);
  r.events.get("storage")({ key: "site_theme", storageArea: {} });
  r.events.get("storage")({ key: "watchlist", storageArea: r.localStorage });
  assert.equal(notifications, 1);
});

test("clear, focus, and restored pages resync the current preference", () => {
  const r = runtime({ stored: "dark" });
  r.data.clear();
  r.events.get("storage")({ key: null, storageArea: r.localStorage });
  assert.equal(r.api.getThemeMode(), "light");
  r.data.set("site_theme", "dark");
  r.events.get("pageshow")();
  assert.equal(r.api.getThemeMode(), "dark");
  r.data.set("site_theme", "light");
  r.events.get("focus")();
  assert.equal(r.api.getThemeMode(), "light");
});

test("blocked storage still permits toggling and keeps the choice during navigation", () => {
  for (const blockedRead of [false, true]) {
    const r = runtime({ blockedRead, blockedWrite: true });
    r.api.setThemeMode("dark");
    r.api.syncThemeForPath("/support");
    assert.equal(r.api.getThemeMode(), "dark");
    r.api.toggleThemeMode();
    assert.equal(r.api.getThemeMode(), "light");
  }
});

test("unselected defaults follow the current route and do not leak on unmount", () => {
  const r = runtime();
  r.api.syncThemeForPath("/global");
  assert.equal(r.api.getThemeMode(), "dark");
  r.api.syncThemeForPath("/realestate-map/");
  assert.equal(r.api.getThemeMode(), "light");
  assert.equal(r.data.size, 0);
});

test("first-paint HTML and React agree for saved, invalid, missing, and blocked storage", () => {
  for (const path of ["/desk", "/realestate-map/", "/support", "/support-success", "/global", "/stock/AAPL", "/"]) {
    for (const stored of [null, "dark", "light", "invalid"]) {
      for (const blockedRead of [false, true]) {
        const r = runtime({ path, stored, blockedRead });
        assert.equal(r.firstPaint, r.api.getThemeMode(), JSON.stringify({ path, stored, blockedRead }));
      }
    }
  }
});
