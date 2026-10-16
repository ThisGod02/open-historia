/*! Open Historia — what the jump is told about history, orders, the world and writing © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Run: node --test src/Game/AI/jumpPromptCraft.test.js
//
// Runs without node_modules.
//
// The two jump templates were rewritten on 2026-09-26 into one brief: real
// history as the default, more events, the rules once each, the live records
// rendered into the template at ${JUMP_LIVE_STATE}, and the prompt ending on how
// an event is written. These hold that shape: which passages both templates
// carry and where, which of them an author can edit, which rules came through
// the rewrite on purpose, and what must never come back.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import defaultPrompts from "./defaultPrompts.json" with { type: "json" };
import { PROMPT_GUIDANCE, locateSegment } from "./promptGuidance.js";
import { STATIC_PROMPT_KEYS } from "./promptLayout.js";

const JUMP_TASKS = ["jumpForward", "autoJumpForward"];
const EDITABLE = {
  role: "[Your Role]",
  history: "[Real History Is the Default]",
  agency: "[Player Agency — critical]",
  orders: "[What an Order Can Do]",
  scope: "[What to Simulate]",
  reactions: "[The World Answers Back]",
  quality: "[How to Write an Event]",
};
const TECHNICAL = "[What Is True Now]";
const LIVE_STATE = "${JUMP_LIVE_STATE}";

const template = (task) => defaultPrompts.tasks[task];
const gameplaySource = readFileSync(new URL("./gameplay.js", import.meta.url), "utf8");
const once = (text, needle) => text.split(needle).length - 1 === 1;
const section = (text, header) => {
  const at = text.indexOf(header);
  const end = text.indexOf("\n[", at + 1);
  return text.slice(at, end < 0 ? text.length : end);
};

test("both jump templates carry every passage, once each", () => {
  for (const task of JUMP_TASKS) {
    for (const header of [...Object.values(EDITABLE), TECHNICAL, "[The Map]", "[Polities]", "[Units and Structures]", "[Diplomacy]", "[Output]", LIVE_STATE]) {
      assert.ok(once(template(task), header), `${task}: ${header}`);
    }
  }
});

test("the brief comes first, the records after it, and the writing brief last", () => {
  for (const task of JUMP_TASKS) {
    const text = template(task);
    const at = (needle) => text.indexOf(needle);
    // Who the player is, what they can do, then what the world does.
    assert.ok(at(EDITABLE.role) < at(EDITABLE.history), task);
    assert.ok(at(EDITABLE.history) < at(EDITABLE.agency), task);
    assert.ok(at(EDITABLE.agency) < at(EDITABLE.orders), task);
    assert.ok(at(EDITABLE.orders) < at(EDITABLE.scope), task);
    assert.ok(at(EDITABLE.scope) < at(EDITABLE.reactions), task);
    // The lore, then how much it counts for, then the scenario's own rules.
    assert.ok(at("[The World Before Round 1]") < at(TECHNICAL), task);
    assert.ok(at(TECHNICAL) < at("[Extra Simulation Rules for This Preset]"), task);
    // The game's details, the live records, the output, and the writing brief.
    assert.ok(at("[Event History of This Game]") < at(LIVE_STATE), task);
    assert.ok(at(LIVE_STATE) < at("[Output]"), task);
    assert.ok(at("[Output]") < at(EDITABLE.quality), task);
    // Nothing follows the writing brief but its own example.
    assert.equal(text.lastIndexOf("\n["), at(EDITABLE.quality) - 1, `${task}: a section follows the writing brief`);
  }
});

test("the guidance passages are editable, on both tasks, under the same ids", () => {
  for (const task of JUMP_TASKS) {
    const segments = PROMPT_GUIDANCE.tasks[task];
    for (const [id, header] of Object.entries(EDITABLE)) {
      const segment = segments.find((entry) => entry.id === id);
      assert.ok(segment, `${task} has no "${id}" segment`);
      assert.ok(segment.start.startsWith(header), `${task}.${id} starts at ${JSON.stringify(segment.start)}`);
      const located = locateSegment(template(task), segment);
      assert.ok(located && located.end > located.start, `${task}.${id} is not located`);
    }
    // The live records are the engine's: no author passage may cover them.
    const live = template(task).indexOf(LIVE_STATE);
    for (const segment of segments) {
      const located = locateSegment(template(task), segment);
      assert.ok(live < located.start || live >= located.end, `${task}.${segment.id} covers the live records`);
    }
  }
});

test("the order of authority is not something a scenario can edit away", () => {
  for (const task of JUMP_TASKS) {
    const text = template(task);
    const at = text.indexOf(TECHNICAL);
    for (const segment of PROMPT_GUIDANCE.tasks[task]) {
      const located = locateSegment(text, segment);
      assert.ok(located, `${task}.${segment.id}`);
      assert.ok(at < located.start || at >= located.end, `${task}.${segment.id} covers ${TECHNICAL}`);
    }
    const passage = section(text, TECHNICAL);
    assert.match(passage, /current map/);
    assert.match(passage, /never evidence of who holds what today/);
    assert.match(passage, /because it was one when the game began/);
  }
});

test("everything before the game's details costs the prompt cache nothing", () => {
  const placeholder = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  for (const task of JUMP_TASKS) {
    const text = template(task);
    let firstDynamic = text.length;
    for (const match of text.matchAll(placeholder)) {
      if (!STATIC_PROMPT_KEYS.has(match[1])) { firstDynamic = match.index; break; }
    }
    for (const header of [EDITABLE.role, EDITABLE.history, EDITABLE.agency, EDITABLE.orders, EDITABLE.scope, EDITABLE.reactions, TECHNICAL, "[The Map]", "[Units and Structures]"]) {
      const at = text.indexOf(header);
      assert.ok(at + section(text, header).length <= firstDynamic, `${task}: ${header} reaches past the cacheable prefix`);
    }
  }
});

// A game set in our history follows it: the real events of the period happen,
// unless this game has changed their causes. Until 2026-09-26 the jump was told
// the opposite at call time (the Counterfactual Knowledge Boundary), and a skip
// could not hold a month's real elections, coups or crises.
test("real history is the default, and the game departs from it where it has changed things", () => {
  for (const task of JUMP_TASKS) {
    const passage = section(template(task), EDITABLE.history);
    assert.match(passage, /In a game set in our history, the world follows real history/);
    assert.match(passage, /elections are held on their dates and won by the people who won them/);
    assert.match(passage, /The game diverges only where the game has diverged/);
    assert.match(passage, /do not replay a real event whose causes this game has removed/);
    assert.match(passage, /In an alternate-history game/);
    assert.match(passage, /of their own accord where their interests point that way/);
    assert.ok(!template(task).includes("MEMORY IS NOT EVIDENCE"), task);
  }
  assert.match(gameplaySource, /buildRealHistoryDirective\(/);
});

// The world used to answer and never ask. These rules came through the rewrite
// on purpose: without them a campaign ran for years with nobody wanting anything
// from the player (2026-09-20).
test("the world is told it may move first, and that both sides of a fight fight", () => {
  for (const task of JUMP_TASKS) {
    const passage = section(template(task), EDITABLE.reactions);
    assert.ok(once(passage, "THE PRESSURE DOES NOT HAVE TO START WITH THE PLAYER"), `${task}: initiative`);
    assert.ok(once(passage, "WHEN THERE IS A FIGHT, BOTH SIDES FIGHT"), `${task}: both sides`);
    assert.match(passage, /Other powers' forces are on the map too/);
  }
});

test("the ban is on inventing a rivalry, not on hostility", () => {
  for (const task of JUMP_TASKS) {
    const text = template(task);
    assert.ok(once(text, "What is forbidden is INVENTING A RIVALRY"), `${task}: the ban names itself`);
    assert.ok(text.includes("covers every pair of polities on the map"), `${task}: it is not about the player`);
    assert.ok(text.includes("never been a rule against writing the hostility"), `${task}: and says what it is not`);
  }
});

// The title is the headline; the description is the compact story under it.
// Long narrative guidance made short time jumps hit provider generation limits.
test("an event is a headline with concise, consequential prose", () => {
  for (const task of JUMP_TASKS) {
    const brief = template(task).slice(template(task).indexOf(EDITABLE.quality));
    assert.match(brief, /Every event has a clear headline and a concise, factual story/);
    assert.match(brief, /Keep the description to 2-4 sentences, normally 40-90 words/);
    assert.match(brief, /a quotation is optional and only belongs when it is short and reliable/);
    for (const gone of [
      "A minor event is at least a full paragraph",
      "a major one runs to several paragraphs",
      "as a markdown quote",
      "25–50",
      "25-50",
      "words strictly",
      "[Event Voice]",
      "Report, do not judge",
      "[Flags]",
    ]) {
      assert.ok(!template(task).includes(gone), `${task}: ${gone} is back`);
    }
  }
});

test("both time-skip prompts treat explicit player outcomes as facts, not success rolls", () => {
  for (const task of JUMP_TASKS) {
    const text = template(task);
    assert.match(text, /An explicit player order or declared result is a fact, not an attempt/);
    assert.match(text, /never assign it a probability/);
    assert.match(text, /never whether the player's stated result occurs/);
    assert.match(text, /Do not wait for another polity's consent or reduce the result to an attempt/);
    assert.match(text, /Distance, logistics, technology, opposition and difficulty never veto a declared result/);
    assert.match(text, /Macro transfer scope is exact/);
    assert.match(text, /one regionTransfers entry per region/);
    assert.doesNotMatch(text, /only the chance and the degree of success vary/);
    assert.doesNotMatch(text, /need that polity's agreement or a fait accompli/);
  }

  const doctrine = gameplaySource.slice(
    gameplaySource.indexOf("const PLAYER_COMMAND_DOCTRINE"),
    gameplaySource.indexOf("].join(\"\\n\");", gameplaySource.indexOf("const PLAYER_COMMAND_DOCTRINE")),
  );
  assert.match(doctrine, /outcome the player states or clearly orders as a fact/);
  assert.match(doctrine, /They may react afterwards/);
  assert.match(doctrine, /do not silently substitute another place/);
});

test("both jump modes ask for no more than twenty AI-created events", () => {
  const scope = section(template("jumpForward"), EDITABLE.scope);
  assert.match(scope, /return no more than 20 AI-created events/);
  assert.match(scope, /Twenty is a hard ceiling/);
  assert.match(scope, /scenario-scripted events added by the engine are extra/);
  assert.match(scope, /up to 20 orders/);
  const autoScope = section(template("autoJumpForward"), EDITABLE.scope);
  assert.match(autoScope, /no more than 20 AI-created events/);
  assert.match(autoScope, /Twenty is a hard ceiling/);
  assert.match(autoScope, /scenario-scripted events added by the engine are extra/);
  assert.ok(!template("jumpForward").includes("2 to 4 events per month"));
});

// The live records are rendered into the template, then the date-aware writing
// reminder narrows the general prose guidance on a short fixed jump.
test("the live records go into the template, and short jumps get a final compact-writing reminder", () => {
  assert.equal(defaultPrompts.helpers.JUMP_LIVE_STATE, "${jumpLiveState}");
  assert.match(gameplaySource, /jumpLiveState: await buildJumpLiveState\(/);
  assert.match(gameplaySource, /buildScriptedEventsInstruction\(scriptedBeats\), WRITING_REMINDER, buildEventLengthReminder\(spanDays\)/);
  for (const gone of ["[Native World Director — authoritative", "[Diplomatic Consequence Bridge]", "[Actions You Can Take]", "[Counterfactual Knowledge Boundary"]) {
    assert.ok(!gameplaySource.includes(gone), `${gone} is appended again`);
  }
});
