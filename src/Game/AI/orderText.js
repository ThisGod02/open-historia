/*! Open Historia — tolerant player-order text matching © 2026 Open Historia contributors. */

const CYRILLIC = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

export const transliterateOrderText = (value) => String(value ?? "")
  .toLocaleLowerCase()
  .replace(/[а-яё]/g, (character) => CYRILLIC[character] ?? character);

export const normalizeOrderText = (value) => transliterateOrderText(value)
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  // A Latin letter accidentally typed before a Cyrillic word becomes a
  // separator after transliteration ("lтерритории" -> "l territorii").
  .replace(/\b[a-z](?=(?:territor|zeml|region|oblast|provin))/g, "")
  .replace(/\b[a-z]\s+(?=[a-z]{5,}\b)/g, "")
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export const orderWords = (value) => normalizeOrderText(value).split(" ").filter(Boolean);

const stem = (value) => {
  const word = normalizeOrderText(value).replace(/\s+/g, "");
  if (!word) return "";
  return word
    .replace(/(?:ami|ymi|imi|ogo|emu|omu|uyu|yuyu|aya|ie|ii|iy|yy|ov|ev|am|yam|akh|yakh|u|yu|a|y|i|e|o)$/i, "")
    .slice(0, 6);
};

const distance = (a, b, max = 2) => {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    let minimum = current[0];
    for (let column = 1; column <= b.length; column += 1) {
      const value = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
      current.push(value);
      minimum = Math.min(minimum, value);
    }
    if (minimum > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
};

const comparableNames = (value) => {
  const normalized = normalizeOrderText(value);
  const words = normalized.split(" ").filter(Boolean);
  const core = words.filter((word) => ![
    "the", "kingdom", "republic", "federal", "state", "states", "of",
    "empire", "union", "commonwealth", "principality", "duchy",
  ].includes(word)).join(" ");
  return [...new Set([normalized, core, stem(core), stem(normalized)].filter(Boolean))];
};

export const orderContainsPolity = (orderText, polityNames = []) => {
  const text = normalizeOrderText(orderText);
  const textWords = orderWords(orderText);
  const textStems = new Set(textWords.map(stem).filter((word) => word.length >= 4));
  return (Array.isArray(polityNames) ? polityNames : [polityNames]).some((name) => {
    const variants = comparableNames(name);
    return variants.some((variant) => {
      if (variant.length >= 5 && text.includes(variant)) return true;
      const variantStem = stem(variant);
      if (variantStem && textStems.has(variantStem)) return true;
      return textWords.some((word) => word.length >= 5 && distance(word, variant, 2) <= 2);
    });
  });
};

export const orderContainsRegion = (orderText, regionName) => {
  const text = normalizeOrderText(orderText);
  const variants = comparableNames(regionName);
  return variants.some((variant) => {
    if (variant.length >= 4 && text.includes(variant)) return true;
    const variantStem = stem(variant);
    if (variantStem && orderWords(orderText).some((word) => stem(word) === variantStem)) return true;
    return orderWords(orderText).some((word) => word.length >= 5 && distance(word, variant, 2) <= 2);
  });
};

export const orderHasTransferIntent = (value) =>
  /(?:pered|ustup|otdat|zakrep|peredach|transfer|cede|grant|assign|hand|give)\w*/i.test(normalizeOrderText(value));

export const orderHasClaimScope = (value) =>
  /(?:pretend|pretenzi|ospar|claim|demand|disput|spor|trebov)\w*/i.test(normalizeOrderText(value));

export const orderHasTerritoryScope = (value) =>
  /(?:territor|zeml|region|oblast|provin|kray|land|territor)\w*/i.test(normalizeOrderText(value));

export const orderHasAllScope = (value) =>
  /(?:vse|kazhd|all|every|each|ostavsh|remain|remaining)\w*/i.test(normalizeOrderText(value));

export const orderHasException = (value) =>
  /(?:isklyuch|except|excluding|bez)\w*/i.test(normalizeOrderText(value));

export const isMacroClaimTransferOrder = (value) =>
  orderHasTransferIntent(value)
  && orderHasTerritoryScope(value)
  && orderHasAllScope(value)
  && orderHasClaimScope(value);
