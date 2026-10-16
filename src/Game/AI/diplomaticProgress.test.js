/*! Open Historia — diplomatic progress tests © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDiplomaticProgressDirective,
  filterContradictorySovereigntyReversals,
} from "./diplomaticProgress.js";

test("ordinary diplomatic messages do not force a final-decision branch", () => {
  assert.equal(buildDiplomaticProgressDirective({
    playerPolity: "Roman Empire",
    playerMessage: "Can we discuss the inspection schedule?",
  }), "");
});

test("a final offer requires acceptance, changed counterterms, or a conclusive refusal", () => {
  const directive = buildDiplomaticProgressDirective({
    playerPolity: "Roman Empire",
    playerMessage: "This is the final proposal. Resolve the sovereignty question now; no further conference.",
    history: [
      { role: "leader", speaker: "Kingdom of Italy", text: "We reject recognition of your sovereignty; the issue remains open." },
    ],
  });
  assert.match(directive, /accept the stated terms/i);
  assert.match(directive, /materially different, specific counteroffer/i);
  assert.match(directive, /final refusal/i);
  assert.match(directive, /do not repeat them unchanged/i);
  assert.match(directive, /regionTransfers/);
});

test("Russian final decision-point wording triggers the same rule", () => {
  const directive = buildDiplomaticProgressDirective({
    playerMessage: "Это наше окончательное предложение. Сегодня решаем вопрос о суверенитете; иначе подписываем протокол разногласий и завершаем конференцию.",
  });
  assert.notEqual(directive, "");
  assert.match(directive, /counteroffer/i);
});

test("an explicit sovereignty acceptance is carried forward as binding conversation canon", () => {
  const history = [{
    id: "accepted-1",
    role: "leader",
    speaker: "Kingdom of Italy",
    text: "Италия принимает передачу суверенитета Римской империи над перечисленными областями по мирному договору.",
  }];
  const directive = buildDiplomaticProgressDirective({ history });
  assert.match(directive, /explicitly accepted/i);
  assert.match(directive, /Acceptance stands unless/);
});

test("an uncaused reversal after acceptance is withheld, but a causally explained reversal remains legal", () => {
  const history = [{
    id: "accepted-1",
    role: "leader",
    speaker: "Kingdom of Italy",
    text: "We accept the treaty recognizing the Empire's sovereignty over the occupied provinces.",
  }];
  const uncaused = {
    type: "send_message",
    actorName: "Kingdom of Italy",
    content: "We reject recognition of the Empire's sovereignty. The status remains open.",
  };
  const filtered = filterContradictorySovereigntyReversals([uncaused], history);
  assert.deepEqual(filtered.actions, []);
  assert.equal(filtered.rejected.length, 1);
  assert.match(filtered.rejected[0].prior.text, /accept the treaty/i);

  const explained = {
    ...uncaused,
    content: "Parliament rejected ratification of the treaty after the government breached the agreed autonomy clause.",
  };
  assert.deepEqual(filterContradictorySovereigntyReversals([explained], history).actions, [explained]);
});
