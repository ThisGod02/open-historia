import { normalizeOrderText, orderContainsPolity } from "./orderText.js";

const UNION_VERB = /(?:\b(?:unif(?:y|ied|ies|ication)|united|merge(?:d|s)?|federat(?:e|ed|ion)|form(?:ed|s)?|found(?:ed|s)?|proclaim(?:ed|s)?)\b|объедин\p{L}*|сформир\p{L}*|созда\p{L}*|основ\p{L}*|провозглас\p{L}*|вошл\p{L}*|слил\p{L}*)/iu;
const COUNTRY_ALIASES = {
  albania: ["албания", "албании", "албанией", "albania", "shqiperi"],
  montenegro: ["черногория", "черногории", "черногорией", "crna gora", "montenegro"],
  kosovo: ["косово", "kosovo"],
  bulgaria: ["болгария", "болгарии", "болгарией", "българия", "bulgaria"],
  greece: ["греция", "греции", "грецию", "греци", "эллада", "hellas", "greece", "hellenic republic"],
  "hellenic republic": ["греция", "греции", "грецию", "греци", "эллада", "hellas", "greece"],
  "north macedonia": ["северная македония", "северной македонии", "македония", "македонии", "north macedonia"],
  turkey: ["турция", "турции", "турцию", "turkey", "turkiye"],
  ukraine: ["украина", "украины", "украине", "украину", "ukraine"],
};

const cleanText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const aliasesFor = (entry) => [
  entry?.token,
  entry?.name,
  ...(Array.isArray(entry?.aliases) ? entry.aliases : []),
].map(cleanText).filter(Boolean);

// Choose the clause that actually states a union/formation. Only names in the
// positive subject clause count as constituent polities; a later sentence such
// as "Turkey and Ukraine did not join" cannot accidentally add them.
const positiveUnionClauses = (text) => cleanText(text)
  .split(/(?<=[.!?])\s+|\n+/)
  .flatMap((sentence) => {
    const matches = [...sentence.matchAll(new RegExp(UNION_VERB.source, "giu"))];
    return matches
      .map((match) => sentence.slice(0, match.index))
      .filter((clause) => {
        const words = new Set(normalizeOrderText(clause).split(" "));
        return !["not", "never", "excluding", "except", "without", "ne", "ni", "krome"]
          .some((word) => words.has(word))
          && !/(?:isklyuch|ne voshl)/i.test(normalizeOrderText(clause));
      });
  })
  .filter(Boolean);

const expandPolityAliases = (entry) => {
  const values = aliasesFor(entry);
  const normalized = values.map(normalizeOrderText);
  for (const [english, aliases] of Object.entries(COUNTRY_ALIASES)) {
    const canonical = normalizeOrderText(english);
    if (normalized.some((value) => value === canonical || value.includes(canonical) || canonical.includes(value))) {
      values.push(...aliases);
    }
  }
  return [...new Set(values)];
};

const explicitlyExcluded = (text, aliases) => {
  const normalized = normalizeOrderText(text);
  return aliases.some((alias) => {
    const name = normalizeOrderText(alias);
    if (!name) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`(?:except|excluding|za\\s+isklyuch\\w*|krome)\\s+(?:the\\s+)?${escaped}`, "i").test(normalized)
      || new RegExp(`${escaped}.{0,48}\\b(?:ne|not|never)\\b.{0,24}(?:voshl|join|enter|participat)`, "i").test(normalized);
  });
};

export const findUnionParticipants = ({
  eventTitle = "",
  eventDescription = "",
  actionText = "",
  targetPolity = "",
  candidates = [],
} = {}) => {
  const clauses = [
    ...positiveUnionClauses(eventDescription),
    ...positiveUnionClauses(actionText),
    ...positiveUnionClauses(eventTitle),
  ];
  if (!clauses.length) return [];

  const targetKey = normalizeOrderText(targetPolity);
  const selected = new Map();
  const allSourceText = [eventDescription, actionText, eventTitle].join(" ");
  for (const candidate of candidates) {
    const aliases = expandPolityAliases(candidate);
    if (!aliases.length || aliases.some((alias) => normalizeOrderText(alias) === targetKey)) continue;
    if (explicitlyExcluded(allSourceText, aliases)) continue;
    if (clauses.some((clause) => aliases.some((alias) =>
      orderContainsPolity(clause, [alias]) || normalizeOrderText(clause).includes(normalizeOrderText(alias))))) {
      const key = normalizeOrderText(candidate.token || candidate.name);
      if (key) selected.set(key, candidate);
    }
  }
  return [...selected.values()];
};

export const isPolityUnionEvent = ({ eventTitle = "", eventDescription = "", actionText = "" } = {}) =>
  [...positiveUnionClauses(eventDescription), ...positiveUnionClauses(actionText), ...positiveUnionClauses(eventTitle)].length > 0;

// Ownership overrides are sparse: unchanged provinces are owned by their
// catalog/base-map owner. A union must therefore resolve control from either
// the live override or the region's own owner metadata.
export const buildUnionTerritoryTransfers = ({
  participants = [],
  regions = [],
  ownershipOverrides = {},
  sovereigntyOverrides = {},
  targetPolity = "",
  existingTransfers = [],
  canonicalizeOwner = (value) => value,
} = {}) => {
  const participantByKey = new Map(
    participants.map((entry) => [
      normalizeOrderText(canonicalizeOwner(entry?.token || entry?.name) || entry?.token || entry?.name),
      String(canonicalizeOwner(entry?.token || entry?.name) || entry?.token || entry?.name || "").trim(),
    ]).filter(([key, token]) => key && token),
  );
  const byId = new Map(regions.map((region) => [String(region?.id ?? ""), region]));
  const existingIds = new Set(existingTransfers.map((entry) => String(entry?.regionId ?? "")));
  const transfers = [];
  for (const [regionId, region] of byId) {
    if (existingIds.has(regionId)) continue;
    const baseOwner = String(
      region?.owner
      || region?.country
      || region?.ownerCode
      || region?.countryCode
      || "",
    ).trim();
    // A controller override is de-facto occupation, not proof of title. Prefer
    // explicit sovereignty, then the map's lawful base owner, and only use the
    // controller when this custom region has no base-owner metadata at all.
    const sovereignRaw = String(
      sovereigntyOverrides?.[regionId]
      || baseOwner
      || ownershipOverrides?.[regionId]
      || "",
    ).trim();
    const sovereign = String(canonicalizeOwner(sovereignRaw) || sovereignRaw).trim();
    const fromCode = participantByKey.get(normalizeOrderText(sovereign));
    if (!fromCode || normalizeOrderText(fromCode) === normalizeOrderText(targetPolity)) continue;
    transfers.push({
      regionId,
      fromCode,
      toCode: targetPolity,
      basis: "unification",
      note: `Deterministic union settlement: transfer territory held by ${fromCode} into ${targetPolity}.`,
    });
  }
  return transfers;
};

export const attachUnionTerritoryTransfers = ({
  event,
  participants = [],
  regions = [],
  ownershipOverrides = {},
  sovereigntyOverrides = {},
  targetPolity = "",
} = {}) => {
  if (!event || typeof event !== "object" || !targetPolity) return { event, transfers: [] };
  const transfers = buildUnionTerritoryTransfers({
    participants,
    regions,
    ownershipOverrides,
    sovereigntyOverrides,
    targetPolity,
    existingTransfers: event.impacts?.regionTransfers,
  });
  if (!transfers.length) return { event, transfers };
  event.impacts ??= {};
  const transferredIds = new Set(transfers.map((entry) => entry.regionId));
  event.impacts.regionTransfers = [
    ...normalizeArraySafe(event.impacts.regionTransfers)
      .filter((entry) => !transferredIds.has(String(entry?.regionId ?? ""))),
    ...transfers,
  ];
  return { event, transfers };
};

const normalizeArraySafe = (value) => Array.isArray(value) ? value : [];
