/*! Open Historia — segmented timeline jump tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/jumpSegments.test.js
//
// Runs without node_modules: jumpSegments.js is import-free.

import test from "node:test";
import assert from "node:assert/strict";
import {
  SEGMENTED_JUMP_MIN_DAYS,
  buildSegmentBriefing,
  STORYLINE_INSTRUCTION,
  buildSegmentInstruction,
  buildEventLengthReminder,
  boundedSegmentEventRange,
  eventCountRangeForDays,
  formatDurationLabel,
  MAX_JUMP_EVENTS,
  mergeSegmentPayloads,
  planJumpEventRanges,
  planJumpSegments,
  pruneJumpPayloadEvents,
  remapJumpPayloadEventIndexes,
  shouldUseJumpLookups,
} from "./jumpSegments.js";
import { ensureScriptedEvents } from "./worldDirection.js";
import { JUMP_FORWARD_SCHEMA } from "./gameplaySchemas.js";

// ---------------------------------------------------------------------------
// Planning

// The reported jump: 270 days, which fell over as one request.
test("a nine-month jump splits into three whole quarters", () => {
  const spans = planJumpSegments(270);
  assert.equal(spans.length, 3);
  assert.equal(spans.reduce((sum, span) => sum + span, 0), 270);
  assert.deepEqual(spans, [90, 90, 90]);
});

// Every split has to add back up, or the round lands on the wrong date.
test("segments always sum to the requested days, for every length", () => {
  for (let days = 1; days <= 800; days += 1) {
    const spans = planJumpSegments(days);
    assert.equal(spans.reduce((sum, span) => sum + span, 0), days, `days=${days}`);
    assert.ok(spans.every((span) => span > 0), `days=${days} produced an empty segment`);
  }
});

// A stub segment would ask for a quarter's worth of events out of a few days.
test("no segment is left as a stub when the days do not divide evenly", () => {
  for (const days of [200, 271, 365, 400, 500, 733]) {
    const spans = planJumpSegments(days);
    const shortest = Math.min(...spans);
    const longest = Math.max(...spans);
    assert.ok(longest - shortest <= 1, `days=${days} produced uneven segments ${spans}`);
  }
});

test("a short jump stays a single segment", () => {
  assert.deepEqual(planJumpSegments(30), [30]);
  assert.deepEqual(planJumpSegments(92), [92]);
  assert.deepEqual(planJumpSegments(0), [0]);
});

test("event ranges respect the twenty-event ceiling", () => {
  assert.deepEqual(eventCountRangeForDays(0.25), [1, 2]);
  assert.deepEqual(eventCountRangeForDays(7), [3, 6]);
  assert.deepEqual(eventCountRangeForDays(30), [5, MAX_JUMP_EVENTS]);
  assert.deepEqual(eventCountRangeForDays(90), [6, MAX_JUMP_EVENTS]);
  assert.deepEqual(eventCountRangeForDays(180), [7, MAX_JUMP_EVENTS]);
  assert.deepEqual(eventCountRangeForDays(365), [8, MAX_JUMP_EVENTS]);
});

test("the entire event budget is divided across segments and never multiplied", () => {
  for (const days of [1, 30, 90, 180, 365, 3650, 36500]) {
    const segments = days >= SEGMENTED_JUMP_MIN_DAYS ? planJumpSegments(days) : [days];
    const ranges = planJumpEventRanges(segments);
    assert.ok(ranges.every(([minimum, maximum]) => minimum >= 0 && maximum >= minimum), `${days}: ${JSON.stringify(ranges)}`);
    assert.ok(ranges.reduce((sum, [, maximum]) => sum + maximum, 0) <= MAX_JUMP_EVENTS, `${days}: ${JSON.stringify(ranges)}`);
    assert.equal(ranges.length, segments.length);
  }
  assert.deepEqual(planJumpEventRanges([30]), [[5, 20]]);
  assert.deepEqual(planJumpEventRanges([90, 90]), [[4, 11], [3, 9]]);
});

test("a segment's event range reserves a slot for later segments", () => {
  assert.deepEqual(boundedSegmentEventRange({
    segmentIndex: 0, segmentCount: 3, budgetRemaining: 10, minEvents: 3, maxEvents: 10,
  }), [3, 8]);
  assert.deepEqual(boundedSegmentEventRange({
    segmentIndex: 2, segmentCount: 3, budgetRemaining: 2, minEvents: 3, maxEvents: 10,
  }), [2, 2]);
});

test("short fixed jumps skip serial lookup rounds; longer and auto jumps keep them", () => {
  for (const days of [0.25, 1, 3, 7]) assert.equal(shouldUseJumpLookups(days), false, `${days} day(s)`);
  for (const days of [8, 30, 365]) assert.equal(shouldUseJumpLookups(days), true, `${days} day(s)`);
  assert.equal(shouldUseJumpLookups(3, "auto"), true, "auto-jumps need to find their next stopping point");
});

test("short jumps carry a compact event-writing reminder", () => {
  assert.match(buildEventLengthReminder(3), /2-4 concise sentences/);
  assert.match(buildEventLengthReminder(30), /40-90 words/);
  assert.match(buildEventLengthReminder(90), /40-90 words/);
});

test("queued orders can raise the minimum but not exceed the twenty-event ceiling", () => {
  const ranges = planJumpEventRanges([90, 90, 90], 20);
  assert.ok(ranges.reduce((sum, [minimum]) => sum + minimum, 0) <= MAX_JUMP_EVENTS);
  assert.ok(ranges.reduce((sum, [, maximum]) => sum + maximum, 0) <= MAX_JUMP_EVENTS);
  assert.equal(ranges.reduce((sum, [minimum]) => sum + minimum, 0), MAX_JUMP_EVENTS);
});

test("the structured jump schema allows up to twenty events per response", () => {
  assert.equal(JUMP_FORWARD_SCHEMA.properties.events.maxItems, 20);
});

test("overflow pruning remaps and drops war, diplomatic, and storyline links safely", () => {
  const payload = {
    events: Array.from({ length: 12 }, (_, index) => ({
      id: `e${index}`,
      title: `Event ${index}`,
      impacts: { actionIds: index === 0 ? ["order-1", "order-2"] : [] },
    })),
    warUpdates: [{ id: "war-kept", eventIndexes: [0, 10] }, { id: "war-drop", eventIndexes: [10] }],
    relationUpdates: [{ id: "relation", eventIndexes: [1, 10] }],
    agreementUpdates: [{ id: "agreement", eventIds: ["missing-id"] }],
    storylineUpdates: [{ id: "story-kept", eventIndexes: [0, 10] }, { id: "story-drop", eventIndexes: [10] }],
  };
  const result = pruneJumpPayloadEvents(payload, 10);

  assert.equal(result.removed, 2);
  assert.equal(payload.events.length, 10);
  assert.deepEqual(payload.events[0].impacts.actionIds, ["order-1", "order-2"]);
  assert.deepEqual(payload.warUpdates, [{ id: "war-kept", eventIndexes: [0] }]);
  assert.deepEqual(payload.relationUpdates, [{ id: "relation", eventIndexes: [1] }]);
  assert.deepEqual(payload.agreementUpdates, []);
  assert.deepEqual(payload.storylineUpdates, [{ id: "story-kept", eventIndexes: [0] }]);
  assert.equal(payload.clearActions, undefined);
});

test("overflow pruning repairs compact string ledger references before their decoders bind ids", () => {
  const payload = {
    events: Array.from({ length: 12 }, (_, index) => ({ id: `e${index}`, title: `Event ${index}` })),
    warUpdates: "war-keep~start~A~B~1,11~note\nwar-drop~start~C~D~11~note",
    relationUpdates: "A~B~-40~strained~1,11~note",
    agreementUpdates: "pact-keep~start~alliance~A,B~1,11~title~terms\npact-drop~start~alliance~C,D~11~title~terms",
    storylineUpdates: "story-keep~active~20~10~2287-01-01~crisis~Crisis~A,B~1,11~state\nstory-drop~active~20~10~2287-01-01~crisis~Other~C,D~11~state",
  };
  pruneJumpPayloadEvents(payload, 10);
  assert.equal(payload.warUpdates, "war-keep~start~A~B~1~note");
  assert.equal(payload.relationUpdates, "A~B~-40~strained~1~note");
  assert.equal(payload.agreementUpdates, "pact-keep~start~alliance~A,B~1~title~terms");
  assert.equal(payload.storylineUpdates, "story-keep~active~20~10~2287-01-01~crisis~Crisis~A,B~1~state");
});

test("an order omitted by a provider overflow stays queued instead of being cleared", () => {
  const payload = {
    events: Array.from({ length: 11 }, (_, index) => ({
      title: `Order ${index}`,
      impacts: { actionIds: [`order-${index}`] },
    })),
  };
  const result = pruneJumpPayloadEvents(payload, 10);
  assert.equal(result.removed, 1);
  assert.equal(result.droppedActionIds.length, 1);
  assert.equal(payload.clearActions, false);
});

test("engine-inserted scripted events remain outside the shared AI event budget", () => {
  const aiEvents = Array.from({ length: 10 }, (_, index) => ({ date: `2287-01-${String(index + 1).padStart(2, "0")}`, title: `AI ${index}` }));
  const selected = pruneJumpPayloadEvents({ events: aiEvents }, 10);
  assert.equal(selected.removed, 0);
  const { events, inserted } = ensureScriptedEvents(aiEvents, [
    { date: "2287-02-20", title: "Scripted Treaty Ratification", text: "Treaty ratification changes the balance of power." },
    { date: "2287-03-21", title: "Scripted Northern Campaign", text: "The northern campaign opens a new front." },
  ]);
  assert.equal(events.length, 12);
  assert.equal(inserted.length, 2);
  assert.equal(aiEvents.length, 10);
});

test("scripted-event chronological sorting remaps positional references before binding", () => {
  const kept = { id: "kept", date: "2287-01-20" };
  const moved = { id: "moved", date: "2287-01-05" };
  const payload = {
    events: [kept, moved],
    warUpdates: "war-1~start~A~B~1~test",
    relationUpdates: "A~B~-20~strained~1~test",
    storylineUpdates: "story-1~active~20~10~2287-01-01~crisis~Crisis~A,B~1~state",
  };
  payload.events = [moved, kept];
  remapJumpPayloadEventIndexes(payload, [kept, moved]);
  assert.equal(payload.warUpdates, "war-1~start~A~B~2~test");
  assert.equal(payload.relationUpdates, "A~B~-20~strained~2~test");
  assert.match(payload.storylineUpdates, /~2~state$/);
});

test("formatDurationLabel collapses even spans", () => {
  assert.equal(formatDurationLabel(365), "1 year");
  assert.equal(formatDurationLabel(90), "3 months");
  assert.equal(formatDurationLabel(14), "2 weeks");
  assert.equal(formatDurationLabel(5), "5 days");
  assert.equal(formatDurationLabel(0.25), "6 hours");
});

// ---------------------------------------------------------------------------
// Instructions

test("a single-segment jump clearly states the hard maximum, plus storyline contract", () => {
  const message = buildSegmentInstruction({
    mode: "jump",
    segmentCount: 1,
    minEvents: 5,
    maxEvents: 20,
    durationLabel: "9 months",
  });

  assert.equal(
    message,
    "Simulate everything that happens in the world from the Origin Date to the target date. Return JSON only. "
    + 'The "events" array should contain between 5 and 20 AI-created events (this jump covers 9 months; '
    + "the hard maximum across the whole jump is 20 AI-created events). Scenario-scripted events added by the engine are extra and do not consume this budget. Date all events where they fall across it. "
    + STORYLINE_INSTRUCTION,
  );
  assert.ok(!/segment/i.test(message));
});

test("an auto jump is never told about segments", () => {
  const message = buildSegmentInstruction({ mode: "auto", segmentCount: 1 });
  assert.match(message, /^Simulate an auto-jump/);
  assert.ok(!/segment/i.test(message));
});

test("the first segment is told it is one round, and given its own span", () => {
  const message = buildSegmentInstruction({
    segmentIndex: 0,
    segmentCount: 3,
    minEvents: 3,
    maxEvents: 4,
    segmentDurationLabel: "3 months",
    originDate: "2287-02-26",
    targetDate: "2287-11-23",
    segmentTargetDate: "2287-05-27",
  });

  assert.match(message, /SINGLE round covering 2287-02-26 to 2287-11-23/);
  assert.match(message, /segment 1 of 3/);
  assert.match(message, /"stopDate" to 2287-05-27/);
  assert.match(message, /between 3 and 4 AI-created events/);
  assert.match(message, /hard ceiling of 20/);
  // Nothing has happened yet, so there is no briefing to guard.
  assert.ok(!/CRITICAL/.test(message));
});

// The requirement this whole mechanism exists to protect: the player cannot have
// answered a segment-one event, so segment two must not punish them for silence.
test("later segments forbid punishing the player for a silence they could not break", () => {
  const message = buildSegmentInstruction({
    segmentIndex: 1,
    segmentCount: 3,
    minEvents: 10,
    maxEvents: 13,
    segmentDurationLabel: "3 months",
    originDate: "2287-02-26",
    targetDate: "2287-11-23",
    segmentTargetDate: "2287-08-25",
    priorEvents: [{ date: "2287-04-01", title: "The Legion masses at Nogales", description: "Cohorts gather." }],
  });

  assert.match(message, /segment 2 of 3/);
  assert.match(message, /COULD NOT have\s+reacted/);
  assert.match(message, /Do NOT portray\s+them as passive/);
  assert.match(message, /do NOT let other powers\s+exploit, punish/);
  assert.match(message, /The Legion masses at Nogales/);
  assert.match(message, /do not restate, rephrase or re-narrate/);
});

test("the briefing lists prior events compactly and caps long descriptions", () => {
  const briefing = buildSegmentBriefing([
    { date: "2287-04-01", title: "A war begins", description: "x".repeat(400) },
    { date: "2287-05-02", title: "A treaty", description: "" },
  ]);

  const [first, second] = briefing.split("\n");
  assert.ok(first.startsWith("- 2287-04-01: A war begins — "));
  assert.ok(first.length < 260, `briefing line was ${first.length} chars`);
  assert.ok(first.endsWith("…"));
  assert.equal(second, "- 2287-05-02: A treaty");
});

test("an empty briefing is empty rather than a stray heading", () => {
  assert.equal(buildSegmentBriefing([]), "");
  assert.equal(buildSegmentBriefing(null), "");
});

// ---------------------------------------------------------------------------
// Merging

test("segments merge into one round's result", () => {
  const merged = mergeSegmentPayloads([
    {
      events: [{ date: "2287-04-01", title: "One" }],
      summary: "The spring.",
      diplomaticOutreach: [{ title: "A feeler" }],
      stopDate: "2287-05-27",
    },
    {
      events: [{ date: "2287-09-01", title: "Two" }],
      summary: "The autumn.",
      diplomaticOutreach: [],
      stopDate: "2287-11-23",
    },
  ], { targetDate: "2287-11-23" });

  assert.deepEqual(merged.events.map((event) => event.title), ["One", "Two"]);
  assert.equal(merged.summary, "The spring.\n\nThe autumn.");
  assert.equal(merged.stopDate, "2287-11-23");
  assert.equal(merged.diplomaticOutreach.length, 1);
  assert.equal(merged.clearActions, true);
});

test("the final segment has the last word on whether orders resolved", () => {
  assert.equal(mergeSegmentPayloads([{ clearActions: true }, { clearActions: false }]).clearActions, false);
  assert.equal(mergeSegmentPayloads([{ clearActions: false }, { clearActions: true }]).clearActions, true);
  // Absent still means resolved, as it always has.
  assert.equal(mergeSegmentPayloads([{ events: [] }]).clearActions, true);
});

// Auto jumps stop early on purpose, so the payload's own stopDate has to win.
test("a payload stopDate outranks the requested target", () => {
  const merged = mergeSegmentPayloads([{ stopDate: "2287-06-14" }], { targetDate: "2287-11-23" });
  assert.equal(merged.stopDate, "2287-06-14");
});

test("a missing stopDate falls back to the requested target", () => {
  const merged = mergeSegmentPayloads([{ events: [] }], { targetDate: "2287-11-23" });
  assert.equal(merged.stopDate, "2287-11-23");
});

test("the split threshold is above a quarter so ordinary skips stay single", () => {
  assert.ok(SEGMENTED_JUMP_MIN_DAYS > 92);
});

test("mergeSegmentPayloads carries every segment's ledger records through the merge", () => {
  const merged = mergeSegmentPayloads([
    {
      events: [{ title: "a" }],
      warUpdates: [{ id: "war-1", op: "start", eventIds: ["segment-1-event-1"] }],
      relationUpdates: "A~B~-40~strained~1~note",
    },
    {
      events: [{ title: "b" }],
      agreementUpdates: [{ id: "pact", op: "start", eventIds: ["segment-2-event-1"] }],
    },
    { events: [{ title: "c" }] },
  ]);
  assert.equal(merged.warUpdates.length, 1);
  assert.deepEqual(merged.warUpdates[0].eventIds, ["segment-1-event-1"]);
  assert.deepEqual(merged.relationUpdates, ["A~B~-40~strained~1~note"]);
  assert.equal(merged.agreementUpdates.length, 1);
  assert.equal(merged.events.length, 3);
});
