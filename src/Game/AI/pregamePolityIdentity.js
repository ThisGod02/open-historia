/*! Open Historia — canonical identity checks for the one-time pre-game ledger bootstrap © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
const clean = (value) => String(value ?? "").trim();

// A dependent territory may declare its sovereign's name as an alias. That
// makes the generic resolver correctly report an ambiguous alias, but must not
// make an exact current polity name invalid in structured ledger output.
export const resolvePregamePolityToken = (token, canonicalPolities, resolveAlias) => {
  const raw = clean(token);
  if (!raw) return { canonical: "", error: "" };

  const allowed = canonicalPolities instanceof Map
    ? canonicalPolities
    : new Map((Array.isArray(canonicalPolities) ? canonicalPolities : [])
      .map(clean)
      .filter(Boolean)
      .map((name) => [name.toLowerCase(), name]));

  const exact = allowed.get(raw.toLowerCase());
  if (exact) return { canonical: exact, error: "" };

  const resolved = clean(typeof resolveAlias === "function" ? resolveAlias(raw) : "");
  const canonical = allowed.get(resolved.toLowerCase()) || "";
  return canonical
    ? { canonical, error: "" }
    : { canonical: "", error: `No unique current polity resolves from "${raw}".` };
};
