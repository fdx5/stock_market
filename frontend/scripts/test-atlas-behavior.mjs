import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../src/components/atlasFlowModel.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const context = vm.createContext({ exports: {}, require: () => ({ pageLabel: path => path }) });
vm.runInContext(source, context);
const model = context.exports;
const action = (id, ts, group = "market") => ({ id, ts, group, type: "click", path: "/stocks", label: `선택 ${id}`, stock_code: "", stock_name: "" });
const graph = { endpoints: [{ path: "/api/visitors/count", group: "operations" }], nodes: [{ id: "database", hosts: ["db.turso.io"] }] };
const live = { at: 1000, api: { recent: [{ id: 1, ts: 999, route: "/api/visitors/count", status: 200, ms: 3 }] },
  external: { recent: [{ id: 2, ts: 999, host: "db.turso.io", status: 200, ms: 2 }] }, traces: [],
  behavior: { sessions: [{ id: "a", events: [action(10, 950), action(11, 999)] }, { id: "b", events: [action(12, 970, "realestate")] }] } };

test("default records contain all sessions' real actions without visit or DB noise", () => {
  const before = JSON.stringify(live);
  const rows = model.flowRecords(graph, live);
  assert.deepEqual(Array.from(rows, r => r.request.id), [11, 12, 10]);
  assert.deepEqual(Array.from(new Set(rows.map(r => r.session))), ["a", "b"]);
  assert(rows.every(r => r.request.method === "USER" && !r.calls.length && !r.batch));
  assert.equal(JSON.stringify(live), before);
});
test("selected session isolates every plotted record and diagnostics remain available", () => {
  assert.deepEqual(Array.from(model.flowRecords(graph, live, "users", "b"), r => r.request.id), [12]);
  const diagnostics = model.flowRecords(graph, live, "system");
  assert.equal(diagnostics.length, 2);
  assert(diagnostics.some(r => r.request.route === "/api/visitors/count"));
  assert(diagnostics.some(r => r.request.host === "db.turso.io"));
  assert.equal(model.flowRecords(graph, live, "users", "missing").length, 0);
});
test("only real observed time windows animate; older actions stay in session history", () => {
  const withOlder = structuredClone(live);
  withOlder.behavior.sessions[0].events.push(action(13, 500), action(14, 1001), action(15, 99));
  assert.equal(model.flowRecords(graph, withOlder).length, 3);
  assert.equal(model.behaviorRecords(withOlder, null, 900).length, 4);
  assert.equal(model.flowRecords(graph, null).length, 0);
});
