import { test } from "node:test";
import assert from "node:assert/strict";
import { publicSharePath, publicShareUrl, publicMarket } from "../src/growth/publicLinks";

test("shared links keep only explicit public market state and campaign tags", () => {
  const value = publicShareUrl("/today/", "?market=kosdaq&token=secret&email=private&name=private&utm_source=old");
  const url = new URL(value!);
  assert.equal(url.origin, "https://kospimap.com");
  assert.equal(url.pathname, "/today");
  assert.deepEqual([...url.searchParams.keys()], ["market", "utm_source", "utm_medium", "utm_campaign"]);
  assert.equal(url.searchParams.get("market"), "kosdaq");
  assert.equal(url.searchParams.get("utm_medium"), "social");
  assert.equal(publicShareUrl("/stock/005930", "?token=secret")?.includes("secret"), false);
});
test("private and unknown routes cannot be shared by the contextual control", () => {
  for (const path of ["/admin", "/admin/growth", "/auth/callback", "/member/private", "//evil.example", "/stock/<script>"]) assert.equal(publicSharePath(path), null);
  assert.equal(publicSharePath("/map", "?code=005930&token=private"), "/map");
});
test("market state is validated and cannot pollute the output query", () => {
  assert.equal(publicMarket("?market=__proto__"), "kospi");
  assert.equal(publicMarket("?market=nasdaq100"), "nasdaq100");
  assert.equal(publicSharePath("/today", "?market=kospi"), "/today");
  assert.equal(publicSharePath("/today", "?market=nasdaq100"), "/today?market=nasdaq100");
  assert.equal(new URL(publicShareUrl("/today", "", "native")!).searchParams.get("utm_source"), "native_share");
  assert.equal(publicSharePath("/desk", "?code=005930&name=private&token=secret"), "/stock/005930");
  assert.equal(publicSharePath("/global", "?code=aapl&token=secret"), "/stock/AAPL");
  assert.equal(publicSharePath("/etf", "?region=US&email=private"), "/etf?region=US");
});
