/*! Open Historia — diplomatic progress in player-led chats © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */

const asText = (value) => String(value ?? "").trim();
const asArray = (value) => Array.isArray(value) ? value : [];

const FINAL_DECISION_RE =
  /\b(?:final|last|finalize|conclude|no further|one last|take it or leave it|protocol of disagreement|final offer|final proposal|resolve today|resolve now|ultima(?:tum|te))\b|(?:окончательн\w*\s+(?:предложени|формул|решени|акт)|последн\w*\s+(?:предложени|конференци|раунд)|протокол(?:ом)?\s+разногласи|без\s+(?:новых\s+)?переговор|больше\s+не\s+будет\s+пересмотр|сегодня\s+решаем|решить\s+сейчас|альтернатив\w*\s+должны\s+быть\s+предложены)/i;

const SOVEREIGNTY_TOPIC_RE =
  /(?:суверенитет|верховенств|передач[аие]\s+(?:земель|территор|власт)|аннекс|территор|sovereignt|sovereign|cession|annex|territor|transfer)/i;
const AFFIRMATIVE_ACCEPTANCE_RE =
  /(?:принима(?:ем|ет|ют|л[аио]?|ть)|соглас(?:ны|ен|на|ились|иться)|одобр(?:яем|яет|или|ить)|подпис(?:ываем|ывает|али|ать)|ратифиц(?:ируем|ирует|ировали|ировать)|утвержда(?:ем|ет|ют|ли|ть)|призна(?:ем|ет|ют|л[аио]?|ть)|переда(?:ем|ет|ют|л[аио]?|ть)\s+(?:суверенитет|территор)|уступ(?:аем|ает|ают|ил[аио]?|ить)\s+(?:земл|территор|суверенитет)|\b(?:we\s+)?(?:accept|agree|approve|sign|ratify|recognize|recognise|cede|transfer)\b|\b(?:accepted|agreed|approved|signed|ratified|recognized|recognised|ceded|transferred)\b)/i;
const ACCEPTANCE_NEGATION_RE =
  /(?:не\s+(?:принимаем|принимает|принимают|согласны|согласен|согласна|можем\s+согласиться|подписываем|подпишем|одобряем|признаем|признаёт|признают|передаем|передаёт|уступаем|уступает)|отказываемся|отвергаем|неприемлемо|неприемлем|\b(?:do\s+not|don't|cannot|can't|will\s+not|won't|refuse|reject|unacceptable)\b)/i;
const ACCEPTANCE_REVERSAL_RE =
  /(?:парламент[^.]{0,100}(?:отклонил|отверг|не\s+ратифиц)|(?:ратификац|ратифицировать)[^.]{0,100}(?:провал|сорвал|отклонил|отверг)|правительств[^.]{0,100}(?:отозвал|отменил|пересмотрел)\s+(?:согласие|решение|подпись)|нарушени[^.]{0,100}(?:договора|соглашения)|(?:договор|соглашение)[^.]{0,100}(?:нарушен|расторгнут|аннулирован)|\b(?:parliament|cabinet)[^.]{0,100}(?:voted down|rejected|overturned)|\b(?:ratification|ratify)[^.]{0,100}(?:failed|blocked|rejected)|\b(?:breach|violation)[^.]{0,100}(?:treaty|agreement)|\b(?:treaty|agreement)[^.]{0,100}(?:breached|terminated|annulled))/i;
const ACCEPTANCE_REVERSAL_WORD_RE =
  /(?:\b(?:reject|refuse|withdraw|revoke|renounce|deny|repudiate|reverse|reconsider|not\s+sign|won't\s+sign|will\s+not\s+sign)\b|отверг|отказ|отозв|аннулир|пересмотр|не\s+подпис|не\s+ратифиц)/i;

const acceptanceIsExplicit = (text) => {
  if (!SOVEREIGNTY_TOPIC_RE.test(text) || !AFFIRMATIVE_ACCEPTANCE_RE.test(text)) return false;
  if (ACCEPTANCE_NEGATION_RE.test(text)) return false;
  // "We agree to continue negotiations" is not acceptance of the territorial term.
  if (/согласны?\s+(?:обсуждать|продолжить|вернуться)|agree\s+to\s+(?:discuss|continue|resume)\s+(?:talks|negotiations)/i.test(text)) return false;
  return true;
};

const explicitReversalHasCause = (text) =>
  ACCEPTANCE_REVERSAL_RE.test(text) && ACCEPTANCE_REVERSAL_WORD_RE.test(text);

/**
 * Enforce continuity only after a participant's unambiguous acceptance of
 * sovereignty/cession terms. A legitimate reversal remains possible, but the
 * message must name the intervening ratification failure, breach, or reversal.
 */
export const filterContradictorySovereigntyReversals = (actions, history) => {
  const acceptedByActor = new Map();
  for (const message of asArray(history)) {
    if (!message || message.role === "user") continue;
    const speaker = asText(message.speaker);
    const text = asText(message.text);
    if (!speaker || !acceptanceIsExplicit(text)) continue;
    acceptedByActor.set(speaker.toLocaleLowerCase(), {
      speaker,
      messageId: asText(message.id),
      text,
    });
  }
  if (!acceptedByActor.size) return { actions: asArray(actions), rejected: [] };

  const kept = [];
  const rejected = [];
  for (const action of asArray(actions)) {
    const actor = asText(action?.actorName).toLocaleLowerCase();
    const prior = acceptedByActor.get(actor);
    const text = asText(action?.content);
    if (
      prior &&
      asText(action?.type).toLowerCase() === "send_message" &&
      SOVEREIGNTY_TOPIC_RE.test(text) &&
      ACCEPTANCE_REVERSAL_WORD_RE.test(text) &&
      !explicitReversalHasCause(text)
    ) {
      rejected.push({ action, prior });
      continue;
    }
    kept.push(action);
  }
  return { actions: kept, rejected };
};

/**
 * Add a focused, context-aware rule only when the player has explicitly asked
 * the conference/chat to reach a final decision. This keeps ordinary diplomacy
 * free to pause, defer, or stay silent.
 */
export const buildDiplomaticProgressDirective = ({ playerMessage = "", history = [], playerPolity = "" } = {}) => {
  const message = asText(playerMessage);
  const recentPositions = asArray(history)
    .filter((entry) => entry && entry.role !== "user")
    .slice(-12)
    .map((entry) => `${asText(entry.speaker)}: ${asText(entry.text)}`)
    .filter((line) => line !== ": ")
    .slice(-6);

  const acceptedPositions = [];
  for (const entry of asArray(history)) {
    if (!entry || entry.role === "user") continue;
    const speaker = asText(entry.speaker);
    const text = asText(entry.text);
    if (speaker && acceptanceIsExplicit(text)) acceptedPositions.push({ speaker, text });
  }
  const lastAcceptanceByActor = new Map();
  for (const acceptance of acceptedPositions) lastAcceptanceByActor.set(acceptance.speaker.toLocaleLowerCase(), acceptance);

  const sections = [];
  if (message && FINAL_DECISION_RE.test(message)) {
    sections.push(
      "[Binding Final-Offer Response]",
      `${asText(playerPolity) || "The player"} has explicitly set a final decision point in their latest message. Every AI-controlled participant directly addressed must answer THIS offer now; do not defer it to another conference, say merely that the issue remains open, or repeat an unchanged refusal already present in this thread.`,
      "Choose a real branch: (1) accept the stated terms, naming what is accepted; (2) reject them and give a materially different, specific counteroffer with exact changed terms; or (3) make a final refusal and state the immediate diplomatic consequence (conference ends, relations worsen, guarantees are withdrawn, or the parties proceed without agreement). Do not fabricate acceptance for a participant whose interests genuinely rule it out.",
      "A counteroffer must change at least one actual term, not just restate autonomy/recognition concerns. If no acceptable compromise exists, close this round with a clear refusal rather than another promise to negotiate later.",
    );
  }
  if (lastAcceptanceByActor.size) {
    sections.push(
      "[Accepted Terms — Binding Conversation Canon]",
      ...[...lastAcceptanceByActor.values()].map(({ speaker, text }) =>
        `- ${speaker} explicitly accepted these sovereignty/cession terms earlier in this conversation: ${text}`),
      "Do not have an accepting participant later say it never accepted, refuse those same terms, or reopen them as unsettled. Acceptance stands unless the current message names a concrete intervening cause such as a ratification vote failing, a material breach, or a competent government formally revoking its approval. A reversal without such a cause is invalid; stay consistent with the acceptance.",
    );
  }
  if (recentPositions.length && message && FINAL_DECISION_RE.test(message)) {
    sections.push(`RECENT AI POSITIONS — do not repeat them unchanged:\n${recentPositions.join("\n")}`);
  }
  if (sections.length) {
    sections.push(
      "A chat records political positions and consent only. Territorial sovereignty changes are applied by a signed/accepted settlement event with matching regionTransfers; chat text by itself does not paint the map.",
    );
  }
  return sections.join("\n");
};
