import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeOrderText,
  orderContainsPolity,
  orderContainsRegion,
  orderHasAllScope,
  orderHasClaimScope,
  orderHasTerritoryScope,
  orderHasTransferIntent,
  isMacroClaimTransferOrder,
} from "./orderText.js";

test("order normalization tolerates Cyrillic, Latin transliteration and a stray Latin prefix", () => {
  assert.equal(normalizeOrderText("передать lтерритории Германии"), "peredat territorii germanii");
  assert.equal(orderHasTransferIntent("передать lтерритории Германии"), true);
  assert.equal(orderHasTerritoryScope("передать lтерритории Германии"), true);
});

test("polity matching tolerates Russian cases, English names and small typos", () => {
  for (const text of ["передать Германии", "передать Germany", "передать Germani", "отдать Германскую землю"]) {
    assert.equal(orderContainsPolity(text, ["Kingdom of Germany", "Germany"]), true, text);
  }
});

test("scope words are detected in Russian and English", () => {
  assert.equal(orderHasClaimScope("все спорные земли, на которые Германия претендует"), true);
  assert.equal(orderHasClaimScope("передать Германии все спорные территории"), true);
  assert.equal(orderHasAllScope("передать оставшиеся регионы"), true);
  assert.equal(orderHasTerritoryScope("transfer the remaining provinces"), true);
  assert.equal(isMacroClaimTransferOrder("передать Германии все спорные территории"), true);
  assert.equal(isMacroClaimTransferOrder("transfer all disputed regions Germany claims"), true);
});

test("region matching tolerates transliteration and case endings", () => {
  assert.equal(orderContainsRegion("передать Германия Luban", "Luban"), true);
  assert.equal(orderContainsRegion("передать Германии Gorzow", "Gorzow"), true);
});
