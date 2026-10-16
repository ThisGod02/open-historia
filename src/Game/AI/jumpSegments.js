/*! Open Historia — segmented timeline jumps © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Splitting one long time skip into several shorter model calls, and putting the
// answers back together as the SINGLE round the player asked for.
//
// Why: a nine-month skip asks one request for 30-odd events, each carrying its
// own impacts — territory, units, markers, projects, diplomacy. That is tens of
// minutes of generation on a hosted provider, sent as one HTTP request with no
// bytes crossing the wire until it finishes, and a gateway closes it long before
// it does. The field report behind this was a 502 at exactly 301.7s on an
// endpoint that was answering every other task fine, which cost the player a turn
// with fourteen queued orders in it. A quarter-sized call finishes well inside
// any proxy window.
//
// The segments are a TRANSPORT detail and must never leak into the fiction. They
// are merged and applied once, so the round advances exactly once (see
// applySimulationResult), and the model is told explicitly that it is mid-round —
// otherwise segment two treats segment one's events as things the player saw and
// failed to answer, and punishes them for a silence they had no chance to break.
//
// Kept free of the game and separate from gameplay.js (which pulls in the whole
// browser runtime and cannot be unit-tested) — its one import, worldDirection.js,
// imports nothing, so this still runs under bare node — for the same reason as
// jsonSalvage.js, providerErrors.js and geminiSchema.js — the arithmetic and the
// merge rules are exactly what wants direct tests.

import { scaleEventRange } from "./worldDirection.js";

const normalizeString = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

// Below this, one request is comfortably fast enough and splitting would only add
// round trips and re-send the prompt for nothing.
export const SEGMENTED_JUMP_MIN_DAYS = 120;
// A quarter: short enough for any proxy window. Each segment asks for its share
// of the whole jump's events (segmentEventRange), so three segments of a
// nine-month jump ask for what one call would have — the same story, in thirds.
export const SEGMENT_TARGET_DAYS = 92;
// Hard campaign-wide ceiling for AI-created events in one time jump, including
// jumps split into several transport calls. Scenario-scripted events are extra.
export const MAX_JUMP_EVENTS = 20;

// Whole days per segment, as near equal as they divide. The remainder is spread
// one day at a time from the front rather than dumped on the last segment, which
// would leave a stub segment asking for a quarter's worth of events from a week.
export const planJumpSegments = (dateStep) => {
  const total = Math.max(0, Math.round(Number(dateStep) || 0));
  if (total <= 0) return [total];
  const count = Math.min(MAX_JUMP_EVENTS, Math.max(1, Math.round(total / SEGMENT_TARGET_DAYS)));
  const base = Math.floor(total / count);
  let remainder = total - base * count;
  const spans = [];
  for (let index = 0; index < count; index += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    spans.push(base + extra);
  }
  return spans;
};

// Desired range for one jump before its shared ceiling is divided among
// transport segments. No time span may request more than twenty AI events.
export const eventCountRangeForDays = (days) => {
  if (days < 1) return [1, 2];   // sub-day skip (e.g. 6 hours)
  if (days <= 7) return [3, 6];
  if (days <= 31) return [5, MAX_JUMP_EVENTS];
  if (days <= 92) return [6, MAX_JUMP_EVENTS];
  if (days <= 184) return [7, MAX_JUMP_EVENTS];
  return [8, MAX_JUMP_EVENTS];
};

// Allocate integer event slots by duration with largest remainders. Respect
// segment capacities, repeating only if one short segment fills early.
// The jump prompt already carries the campaign state. Extra lookup rounds
// re-send that large context and add serial provider calls, so they are not
// worth the latency for a few days' span. Auto-jumps have an open-ended horizon
// and retain lookups even when their initial estimate is short.
export const shouldUseJumpLookups = (days, mode = "jump") =>
  mode === "auto" || Number(days) > 7;

// Bound only the final model answer, not the prompt. The estimate grows with
// the requested event ceiling so a month still has room for map/ledger ops,
// while a short jump cannot spend a provider's five-minute window on prose.
export const jumpOutputTokenBudget = (maxEvents) => Math.min(
  20_000,
  Math.max(8_192, 3_000 + Math.max(1, Math.round(Number(maxEvents) || 1)) * 650),
);

// Human-readable label for the skipped span, used in the AI prompt. Collapses
// whole-day counts into weeks/months/years where they divide evenly.
export const formatDurationLabel = (days) => {
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const whole = Math.round(days);
  const pluralize = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (whole % 365 === 0) return pluralize(whole / 365, "year");
  if (whole % 30 === 0) return pluralize(whole / 30, "month");
  if (whole % 7 === 0) return pluralize(whole / 7, "week");
  return pluralize(whole, "day");
};

// The per-segment event floor. Queued actions raise the requested lower bound,
// but can never break the twenty-event campaign-wide ceiling.
//
// `pace` is the scenario author's setting (worldDirection.js scaleEventRange): it
// scales how crowded a period is, BEFORE the queued orders raise the floor — an
// author who wants a sparse chronicle still owes the player a slot per order.
//
// `totalDays` is the whole jump when this span is one of several segments.
export const segmentEventRange = (spanDays, plannedActionShare, { pace = 100, totalDays = 0 } = {}) => {
  const whole = Number(totalDays) > Number(spanDays) ? Number(totalDays) : 0;
  const base = whole
    ? eventCountRangeForDays(whole).map((count) => Math.max(1, Math.round((count * spanDays) / whole)))
    : eventCountRangeForDays(spanDays);
  let [minEvents, maxEvents] = scaleEventRange(base, pace);
  if (plannedActionShare > minEvents) {
    minEvents = Math.min(plannedActionShare, MAX_JUMP_EVENTS);
    maxEvents = Math.max(maxEvents, minEvents + 3);
  }
  return [
    Math.min(minEvents, MAX_JUMP_EVENTS),
    Math.min(Math.max(maxEvents, minEvents), MAX_JUMP_EVENTS),
  ];
};

// Allocate the shared event budget by segment duration using largest
// remainders. This keeps the transport segmentation from multiplying the
// player's twenty-event ceiling.
const distributeEventBudget = (total, capacities, weights) => {
  const allocation = capacities.map(() => 0);
  let remaining = Math.max(
    0,
    Math.min(
      Math.floor(Number(total) || 0),
      capacities.reduce((sum, value) => sum + Math.max(0, Math.floor(value)), 0),
    ),
  );

  while (remaining > 0) {
    const eligible = capacities
      .map((capacity, index) => ({ index, room: Math.max(0, Math.floor(capacity) - allocation[index]) }))
      .filter(({ room }) => room > 0);
    if (!eligible.length) break;
    const weightTotal = eligible.reduce((sum, { index }) => sum + Math.max(0, Number(weights[index]) || 0), 0);
    const denominator = weightTotal || eligible.length;
    const shares = eligible.map(({ index }) => {
      const weight = weightTotal ? Math.max(0, Number(weights[index]) || 0) : 1;
      const exact = (remaining * weight) / denominator;
      const whole = Math.min(
        Math.max(0, Math.floor(capacities[index]) - allocation[index]),
        Math.floor(exact),
      );
      return { index, whole, fraction: exact - Math.floor(exact) };
    });
    const placed = shares.reduce((sum, share) => sum + share.whole, 0);
    for (const { index, whole } of shares) allocation[index] += whole;
    remaining -= placed;
    if (remaining <= 0) break;
    const remainderOrder = shares
      .filter(({ index }) => allocation[index] < Math.floor(capacities[index]))
      .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    const distributed = Math.min(remaining, remainderOrder.length);
    for (let index = 0; index < distributed; index += 1) {
      allocation[remainderOrder[index].index] += 1;
    }
    remaining -= distributed;
    if (!placed && !distributed) break;
  }
  return allocation;
};

// Pick the number of events for a segment, preferring its duration-weighted
// share while guaranteeing enough event slots remain for every later segment.
export const boundedSegmentEventRange = ({
  segmentIndex,
  segmentCount,
  budgetRemaining,
  minEvents,
  maxEvents,
}) => {
  const remaining = Math.max(0, Math.min(MAX_JUMP_EVENTS, Math.floor(Number(budgetRemaining) || 0)));
  const segmentsLeft = Math.max(1, Math.floor(Number(segmentCount) || 1) - Math.floor(Number(segmentIndex) || 0));
  const floor = Math.max(0, Math.floor(Number(minEvents) || 0));
  const ceiling = Math.max(floor, Math.floor(Number(maxEvents) || 0));
  const reserveForLater = Math.min(remaining, Math.max(0, segmentsLeft - 1));
  const currentCeiling = Math.max(0, Math.min(ceiling, remaining - reserveForLater));
  const currentFloor = Math.min(currentCeiling, floor);
  return [currentFloor, currentCeiling];
};

const eventIdentity = (event) =>
  `${normalizeString(event?.date)}|${normalizeString(event?.title).toLowerCase()}`;

export const remapJumpPayloadEventIndexes = (payload, priorEventOrder) => {
  if (!payload || typeof payload !== "object" || !Array.isArray(priorEventOrder)) return payload;
  const nextIndexes = new Map(asArray(payload.events).map((event, index) => [event, index]));
  const indexMap = new Map(priorEventOrder.map((event, index) => [index, nextIndexes.get(event)]));
  for (const field of ["warUpdates", "relationUpdates", "agreementUpdates", "storylineUpdates"]) {
    const value = payload[field];
    if (typeof value === "string") {
      const eventFieldIndex = field === "warUpdates" ? 4
        : field === "relationUpdates" ? -2
          : field === "agreementUpdates" ? 4
            : field === "storylineUpdates" ? 8 : -1;
      payload[field] = value.split(/\r?\n/).map((line) => {
        const parts = line.split("~");
        const position = eventFieldIndex === -2 ? (parts.length >= 7 ? 5 : 4) : eventFieldIndex;
        if (position < 0 || position >= parts.length || !parts[position].trim()) return line;
        const refs = parts[position].split(",").map((raw) => Number(raw.trim()) - 1)
          .filter((index) => Number.isInteger(index) && index >= 0);
        const mapped = refs.map((index) => indexMap.get(index)).filter(Number.isInteger).map((index) => index + 1);
        if (refs.length && !mapped.length) return "";
        parts[position] = mapped.join(",");
        return parts.join("~");
      }).filter(Boolean).join("\n");
    } else if (Array.isArray(value)) {
      payload[field] = value.flatMap((record) => {
        if (!record || typeof record !== "object" || !Array.isArray(record.eventIndexes)) return [record];
        const mapped = record.eventIndexes.map(Number)
          .map((index) => indexMap.get(index))
          .filter(Number.isInteger);
        if (record.eventIndexes.length && !mapped.length && !record.eventIds?.length) return [];
        return [{ ...record, eventIndexes: mapped }];
      });
    }
  }
  return payload;
};

// Keep the most consequential records if a non-conforming provider returns
// more events than the current segment's structured-output ceiling allows.
export const selectEventsWithinLimit = (events, limit, { priorityEvents = [] } = {}) => {
  const list = asArray(events);
  const ceiling = Math.max(0, Math.floor(Number(limit) || 0));
  if (list.length <= ceiling) return list;
  if (!ceiling) return [];
  const priority = new Set(asArray(priorityEvents).map(eventIdentity));
  const ranked = list.map((event, index) => ({
    event,
    index,
    score:
      (priority.has(eventIdentity(event)) ? 100 : 0)
      + (asArray(event?.impacts?.actionIds).length ? 1_000 : 0)
      + (event?.notable === true ? 30 : 0)
      + (normalizeString(event?.importance).toLowerCase() === "major" ? 20 : 0)
      + (event?.playerRelated === true ? 10 : 0)
      + (index === list.length - 1 ? 5 : 0),
  }));
  return ranked
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, ceiling)
    .sort((a, b) => a.index - b.index)
    .map(({ event }) => event);
};

export const pruneJumpPayloadEvents = (payload, limit, { priorityEvents = [], protectedEvents = [] } = {}) => {
  if (!payload || typeof payload !== "object") return { removed: 0, retainedIndexes: [] };
  const events = asArray(payload.events);
  const protectedKeys = new Set(asArray(protectedEvents).map(eventIdentity));
  const aiEvents = events.filter((event) => !protectedKeys.has(eventIdentity(event)));
  const retainedEvents = new Set([
    ...events.filter((event) => protectedKeys.has(eventIdentity(event))),
    ...selectEventsWithinLimit(aiEvents, limit, { priorityEvents }),
  ]);
  const retainedIndexes = events.map((event, index) => retainedEvents.has(event) ? index : -1).filter((index) => index >= 0);
  if (retainedIndexes.length === events.length) return { removed: 0, retainedIndexes };
  const indexMap = new Map(retainedIndexes.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  const keptEvents = retainedIndexes.map((index) => events[index]);
  const keptIds = new Set(keptEvents.map((event) => normalizeString(event?.id)).filter(Boolean));
  payload.events = keptEvents;
  for (const field of ["warUpdates", "relationUpdates", "agreementUpdates", "storylineUpdates"]) {
    const value = payload[field];
    if (typeof value === "string") {
      const eventFieldIndex = field === "warUpdates" ? 4
        : field === "relationUpdates" ? -2
          : field === "agreementUpdates" ? 4
            : field === "storylineUpdates" ? 8 : -1;
      payload[field] = value.split(/\r?\n/).map((line) => {
        const parts = line.split("~");
        const position = eventFieldIndex === -2 ? (parts.length >= 7 ? 5 : 4) : eventFieldIndex;
        if (position < 0 || position >= parts.length || !parts[position].trim()) return line;
        const hadNumbers = parts[position].split(",").map((raw) => Number(raw.trim()) - 1)
          .filter((index) => Number.isInteger(index) && index >= 0);
        const mapped = hadNumbers.filter((index) => indexMap.has(index)).map((index) => indexMap.get(index) + 1);
        if (hadNumbers.length && !mapped.length) return "";
        parts[position] = mapped.join(",");
        return parts.join("~");
      }).filter(Boolean).join("\n");
      continue;
    }
    if (!Array.isArray(value)) continue;
    payload[field] = payload[field].flatMap((record) => {
      if (!record || typeof record !== "object") return [record];
      const indexes = Array.isArray(record.eventIndexes) ? record.eventIndexes : null;
      const ids = Array.isArray(record.eventIds) ? record.eventIds : null;
      const mappedIds = ids ? ids.filter((id) => keptIds.has(normalizeString(id))) : [];
      const mappedIndexes = indexes
        ? indexes.map(Number).filter((index) => indexMap.has(index)).map((index) => indexMap.get(index))
        : [];
      if (ids?.length && !mappedIds.length) return [];
      if (!ids?.length && indexes?.length && !mappedIndexes.length) return [];
      return [{
        ...record,
        ...(ids?.length ? { eventIds: mappedIds, eventIndexes: [] } : (indexes?.length ? { eventIndexes: mappedIndexes } : {})),
      }];
    });
  }
  const retainedActionIds = new Set(keptEvents.flatMap((event) => asArray(event?.impacts?.actionIds).map(normalizeString)));
  const droppedActionIds = [...new Set(events
    .filter((event) => !retainedEvents.has(event))
    .flatMap((event) => asArray(event?.impacts?.actionIds).map(normalizeString))
    .filter((id) => id && !retainedActionIds.has(id)))];
  if (droppedActionIds.length) payload.clearActions = false;
  return { removed: events.length - keptEvents.length, retainedIndexes, droppedActionIds };
};

// The maxima returned here add up to no more than twenty across all transport
// segments of one requested jump.
export const planJumpEventRanges = (segmentDays, plannedActionCount = 0, { pace = 100 } = {}) => {
  const spans = Array.isArray(segmentDays) && segmentDays.length ? segmentDays : [0];
  const totalDays = spans.reduce((sum, days) => sum + Math.max(0, Number(days) || 0), 0);
  const [naturalMinimum, naturalMaximum] = scaleEventRange(eventCountRangeForDays(totalDays), pace);
  const hasPlannedActions = Math.max(0, Math.floor(Number(plannedActionCount) || 0)) > 0;
  const totalMinimum = Math.min(
    MAX_JUMP_EVENTS,
    Math.max(
      naturalMinimum,
      hasPlannedActions ? Math.min(MAX_JUMP_EVENTS, Math.floor(Number(plannedActionCount) || 0)) : 0,
    ),
  );
  const totalMaximum = Math.min(
    MAX_JUMP_EVENTS,
    Math.max(totalMinimum, naturalMaximum),
  );
  const capacities = spans.map(() => MAX_JUMP_EVENTS);
  const minimums = distributeEventBudget(totalMinimum, capacities, spans);
  const remainingCapacities = capacities.map((capacity, index) => capacity - minimums[index]);
  const extras = distributeEventBudget(totalMaximum - totalMinimum, remainingCapacities, spans);
  return minimums.map((minimum, index) => [minimum, minimum + extras[index]]);
};

const MAX_BRIEFING_EVENTS = 40;
const MAX_BRIEFING_DESCRIPTION = 200;

// What the earlier segments already wrote, compact enough to re-send each time.
// The world is NOT advanced between segments (that would mint extra rounds), so
// this text is the only continuity the next call gets.
export const buildSegmentBriefing = (priorEvents) => {
  const events = asArray(priorEvents).slice(-MAX_BRIEFING_EVENTS);
  if (events.length === 0) return "";
  return events
    .map((event) => {
      const date = normalizeString(event?.date) || "undated";
      const title = normalizeString(event?.title) || "(untitled)";
      const description = normalizeString(event?.description);
      const trimmed = description.length > MAX_BRIEFING_DESCRIPTION
        ? `${description.slice(0, MAX_BRIEFING_DESCRIPTION).trimEnd()}…`
        : description;
      return `- ${date}: ${title}${trimmed ? ` — ${trimmed}` : ""}`;
    })
    .join("\n");
};

// The instruction for one segment.
//
// A single-segment jump returns EXACTLY the wording it always had: a jump that
// does not need splitting must not be told anything about segments, and the
// prompt it sends should be byte-identical to the one before this existed.
// The storyline contract rides with every jump instruction. The record format
// and the doctrine come from the world director's directive (gameplay.js);
// this is the reminder that the records must actually come back.
export const STORYLINE_INSTRUCTION =
  "Give every storyline due this period its storylineUpdates record, with where it stands on the stop date, "
  + "and open one for each new process that will run on.";

// The last thing every jump request says: the writing brief, where a long prompt
// is followed best (the template's [How to Write an Event] has it in full).
export const WRITING_REMINDER =
  "Write every event as How to Write an Event describes: the title is the headline, and the description tells "
  + "the story under it — who did what, where, how, in what order, and what came of it — never the headline again "
  + "in more words.";

// The general history brief deliberately allows major events to run for several
// paragraphs. That fits long chronicles, but a short jump can spend its entire
// provider window on one overgrown event.
export const buildEventLengthReminder = (days) => {
  void days;
  return "Keep each event description compact: usually 2-4 concise sentences and 40-90 words. State the material change and its important consequences. Use extra detail or a longer quotation only for a genuinely pivotal turning point; avoid routine dossiers, biographies, and operational minutiae.";
};

export const buildSegmentInstruction = ({
  mode = "jump",
  segmentIndex = 0,
  segmentCount = 1,
  minEvents,
  maxEvents,
  durationLabel,
  segmentDurationLabel,
  originDate,
  targetDate,
  segmentTargetDate,
  priorEvents = [],
} = {}) => {
  const autoMessage =
    "Simulate an auto-jump: run the world forward from the Origin Date and stop at the first event that needs the "
    + "player, which comes last and is notable. Return JSON only. Scale the events to the time you actually cover "
     + `before that point, but return no more than ${MAX_JUMP_EVENTS} AI-created events total — fewer when the stopping point `
    + "comes early — dated where they fall. "
    + STORYLINE_INSTRUCTION;
  const jumpMessage =
    `Simulate everything that happens in the world from the Origin Date to the target date. Return JSON only. ` +
    `The "events" array should contain between ${minEvents} and ${maxEvents} AI-created events (this jump covers ${durationLabel}; `
    + `the hard maximum across the whole jump is ${MAX_JUMP_EVENTS} AI-created events). Scenario-scripted events added by the engine are extra and do not consume this budget. Date all events where they fall across it. ${STORYLINE_INSTRUCTION}`;

  if (segmentCount <= 1) return mode === "auto" ? autoMessage : jumpMessage;

  const position = `segment ${segmentIndex + 1} of ${segmentCount}`;
  const lines = [
    `[One Round, Simulated In Segments] This is ${position} of a SINGLE round covering `
    + `${originDate} to ${targetDate}. The segments exist only so the simulation can be generated in `
    + `pieces — in the game's fiction this is one continuous stretch of time, not ${segmentCount} turns.`,
    "",
    `Simulate ONLY ${segmentIndex === 0 ? originDate : "the period after the last segment"} up to `
    + `${segmentTargetDate}, and set "stopDate" to ${segmentTargetDate}. The "events" array must contain `
     + `between ${minEvents} and ${maxEvents} AI-created events (this segment covers ${segmentDurationLabel}; the whole jump `
     + `has a hard ceiling of ${MAX_JUMP_EVENTS} AI-created events; scenario-scripted events added by the engine are extra), with their `
    + "dates spread across that span. Return JSON only.",
    "",
    STORYLINE_INSTRUCTION,
  ];

  if (segmentIndex > 0) {
    const briefing = buildSegmentBriefing(priorEvents);
    lines.push(
      "",
      "[What Has Already Happened This Round]",
      briefing || "(nothing yet)",
      "",
      // The requirement this whole mechanism has to protect. Without it the model
      // reads the briefing as history the player lived through and stayed silent
      // on, and writes the consequences of an inaction that never happened.
      "CRITICAL: the events above happened DURING this same round, while the simulation was still "
      + "running. The player has issued no new orders since the round began and COULD NOT have "
      + "reacted to any of them — there was no point at which they were asked to. Do NOT portray "
      + "them as passive, negligent, hesitant, caught off guard, or silent; do NOT let other powers "
      + "exploit, punish, or remark upon a failure to respond; and do NOT open events with the "
      + "player's lack of an answer. Their queued orders for this round cover this whole period and "
      + "may keep developing across it. Continue the story forward from where the last segment "
      + "ended, and do not restate, rephrase or re-narrate any event listed above.",
    );
  }

  return lines.join("\n");
};

// One turn's worth of result out of every segment's payload.
//
// Merge rules, and why each is what it is:
//   events              concatenated in order — the round's story, start to end.
//   stopDate            the last segment's own, falling back to the requested
//                       target — the same precedence the single-call path has
//                       always had, which auto-jumps depend on because they stop
//                       early ON PURPOSE at the next notable moment.
//   summary             the segment summaries in order; each covers its own span,
//                       so joining them describes the whole period without asking
//                       any one call to summarise time it never saw.
//   diplomaticOutreach  concatenated — every approach made during the round.
//   clearActions        the final segment's word, keeping the `!== false` default
//                       (absent means resolved) the single-call path has always had.
const asLedgerRecords = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
};

export const mergeSegmentPayloads = (payloads, { targetDate = "" } = {}) => {
  const segments = asArray(payloads).filter(Boolean);
  const events = [];
  const diplomaticOutreach = [];
  // Ledger records (warUpdates / relationUpdates / agreementUpdates /
  // storylineUpdates). By the
  // time a segment is accepted its records are bound to that segment's own
  // event ids (gameplay.js validateSegmentLedgers), so they simply concatenate;
  // a record still in its raw line form is split into lines, which the ledger
  // decoders accept too.
  const warUpdates = [];
  const relationUpdates = [];
  const agreementUpdates = [];
  const storylineUpdates = [];
  const summaries = [];
  let clearActions = true;
  let stopDate = "";

  for (const payload of segments) {
    events.push(...asArray(payload.events));
    diplomaticOutreach.push(...asArray(payload.diplomaticOutreach));
    warUpdates.push(...asLedgerRecords(payload.warUpdates));
    relationUpdates.push(...asLedgerRecords(payload.relationUpdates));
    agreementUpdates.push(...asLedgerRecords(payload.agreementUpdates));
    storylineUpdates.push(...asLedgerRecords(payload.storylineUpdates));
    const summary = normalizeString(payload.summary);
    if (summary) summaries.push(summary);
    clearActions = payload.clearActions !== false;
    const segmentStop = normalizeString(payload.stopDate);
    if (segmentStop) stopDate = segmentStop;
  }

  return {
    clearActions,
    agreementUpdates,
    diplomaticOutreach,
    events,
    relationUpdates,
    stopDate: stopDate || normalizeString(targetDate),
    storylineUpdates,
    warUpdates,
    summary: summaries.join("\n\n"),
  };
};
