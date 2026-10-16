import test from "node:test";
import assert from "node:assert/strict";

import { resolvePregamePolityToken } from "./pregamePolityIdentity.js";

const POLITIES = new Map([
  ["united kingdom", "United Kingdom"],
  ["british raj", "British Raj"],
  ["france", "France"],
]);

test("an exact current polity name wins over a dependent territory's ambiguous alias", () => {
  const result = resolvePregamePolityToken("United Kingdom", POLITIES, () => "");
  assert.deepEqual(result, { canonical: "United Kingdom", error: "" });
});

test("a non-canonical token is accepted only when its alias resolves uniquely to a current polity", () => {
  const resolved = resolvePregamePolityToken("Great Britain", POLITIES, () => "United Kingdom");
  const ambiguous = resolvePregamePolityToken("British", POLITIES, () => "");
  const unknown = resolvePregamePolityToken("Atlantis", POLITIES, () => "");
  assert.deepEqual(resolved, { canonical: "United Kingdom", error: "" });
  assert.equal(ambiguous.canonical, "");
  assert.match(ambiguous.error, /British/);
  assert.equal(unknown.canonical, "");
});
