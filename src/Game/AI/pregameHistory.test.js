import test from "node:test";
import assert from "node:assert/strict";

import { PREGAME_HISTORY_SCHEMA, validateGameplayPayload } from "./gameplaySchemas.js";

const event = (description = "A concise historical event.") => ({
  date: "1909-12-01",
  title: "A turning point",
  description,
});

const relation = () => ({
  kind: "relation",
  id: "",
  polities: ["Austria-Hungary", "France"],
  opponents: [],
  score: -50,
  pressure: 0,
  momentum: 0,
  date: "",
  category: "",
  title: "",
  detail: "Relations are strained.",
});

const payload = () => ({
  events: [event()],
  summary: "A concise summary of the period before the campaign.",
  canonicalUpdates: [],
});

test("pre-game history bounds event count and visible prose", () => {
  assert.equal(PREGAME_HISTORY_SCHEMA.properties.events.maxItems, 6);
  assert.equal(PREGAME_HISTORY_SCHEMA.properties.events.items.properties.description.maxLength, 700);
  assert.equal(PREGAME_HISTORY_SCHEMA.properties.summary.maxLength, 450);
  assert.equal(validateGameplayPayload("pregameHistory", payload()).valid, true);

  const tooMany = payload();
  tooMany.events = Array.from({ length: 7 }, (_, index) => ({ ...event(), title: `Event ${index}` }));
  assert.match(validateGameplayPayload("pregameHistory", tooMany).error, /at most 6 items/);

  const overlong = payload();
  overlong.events[0].description = "x".repeat(701);
  assert.match(validateGameplayPayload("pregameHistory", overlong).error, /at most 700 characters/);
});

test("the Day-One ledger envelope is deliberately bounded and relation notes stay concise", () => {
  assert.equal(PREGAME_HISTORY_SCHEMA.properties.canonicalUpdates.maxItems, 16);
  const tooMany = payload();
  tooMany.canonicalUpdates = Array.from({ length: 17 }, relation);
  assert.match(validateGameplayPayload("pregameHistory", tooMany).error, /at most 16 items/);

  const overlong = payload();
  overlong.canonicalUpdates = [relation()];
  overlong.canonicalUpdates[0].detail = "x".repeat(321);
  assert.match(validateGameplayPayload("pregameHistory", overlong).error, /at most 320 characters/);
});
