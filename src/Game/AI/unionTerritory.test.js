import test from "node:test";
import assert from "node:assert/strict";
import {
  attachUnionTerritoryTransfers,
  buildUnionTerritoryTransfers,
  findUnionParticipants,
  isPolityUnionEvent,
} from "./unionTerritory.js";

const candidates = [
  { token: "Republic of Albania", name: "Republic of Albania", aliases: ["Albania"] },
  { token: "Montenegro", name: "Montenegro", aliases: [] },
  { token: "Republic of Kosovo", name: "Republic of Kosovo", aliases: ["Kosovo"] },
  { token: "Republic of Bulgaria", name: "Republic of Bulgaria", aliases: ["Bulgaria"] },
  { token: "Hellenic Republic", name: "Hellenic Republic", aliases: ["Greece"] },
  { token: "Republic of North Macedonia", name: "Republic of North Macedonia", aliases: ["North Macedonia"] },
  { token: "Turkey", name: "Turkey", aliases: [] },
  { token: "Ukraine", name: "Ukraine", aliases: [] },
  { token: "Balkan Kingdom", name: "Balkan Kingdom", aliases: [] },
];

test("extracts only the six named founders, not countries mentioned as excluded later", () => {
  const participants = findUnionParticipants({
    eventTitle: "Балканское королевство оформило объединение шести государств",
    eventDescription: "Албания, Черногория, Косово, Болгария, Греция и Северная Македония провозгласили единое Балканское королевство. Турция и Украина в объединение не вошли.",
    actionText: "Балканские страны, за исключением Турции и Украины, объединились в новое, Балканское королевство (объединились Албания, Черногория, Косово, Болгария, Греция и Северная Македония).",
    targetPolity: "Balkan Kingdom",
    candidates,
  });
  assert.deepEqual(
    participants.map((entry) => entry.token),
    [
      "Republic of Albania",
      "Montenegro",
      "Republic of Kosovo",
      "Republic of Bulgaria",
      "Hellenic Republic",
      "Republic of North Macedonia",
    ],
  );
});

test("does not infer a transfer from a diplomatic proposal that only discusses union", () => {
  assert.equal(isPolityUnionEvent({
    eventDescription: "The new Balkan Kingdom said it would study Austria's proposal to join the empire.",
    actionText: "Austria offered union to the Balkan states.",
  }), false);
});

test("recognizes a concrete union when the event is phrased as a federation", () => {
  assert.equal(isPolityUnionEvent({
    eventDescription: "Albania and Montenegro formed a federation under a joint crown.",
  }), true);
});

test("recognizes Russian case forms and Hellenic Republic as Greece", () => {
  const participants = findUnionParticipants({
    eventDescription: "Албания, Черногория, Косово, Болгария, Греция и Северная Македония провозгласили единое Балканское королевство.",
    targetPolity: "Balkan Kingdom",
    candidates,
  });
  assert.equal(participants.length, 6);
  assert.ok(participants.some((entry) => entry.token === "Hellenic Republic"));
});

test("union transfers include sparse base-map owners, honor overrides, and exclude non-founders", () => {
  const transfers = buildUnionTerritoryTransfers({
    participants: [
      { token: "Republic of Albania" },
      { token: "Hellenic Republic" },
      { token: "Montenegro" },
    ],
    regions: [
      { id: "albania-1", name: "Shkoder", country: "Republic of Albania" },
      { id: "greece-1", name: "Athens", country: "Hellenic Republic" },
      { id: "montenegro-1", name: "Cetinje", country: "Montenegro" },
      { id: "turkey-1", name: "Edirne", country: "Turkey" },
      { id: "austria-1", name: "Vienna", country: "Kingdom of Austria" },
      { id: "occupied-albania-1", name: "Tirana", country: "Republic of Albania" },
    ],
    ownershipOverrides: {
      "greece-1": "Kingdom of Austria",
      "turkey-1": "Hellenic Republic",
      "occupied-albania-1": "Kingdom of Austria",
    },
    sovereigntyOverrides: {
      "greece-1": "Hellenic Republic",
      "turkey-1": "Turkey",
    },
    targetPolity: "Balkan Kingdom",
  });
  assert.deepEqual(transfers.map(({ regionId, fromCode }) => [regionId, fromCode]), [
    ["albania-1", "Republic of Albania"],
    ["greece-1", "Hellenic Republic"],
    ["montenegro-1", "Montenegro"],
    ["occupied-albania-1", "Republic of Albania"],
  ]);
});

test("a polity creation event receives the canonical territory operations it needs to appear on the map", () => {
  const event = {
    title: "The Balkan Kingdom is proclaimed",
    impacts: {
      polityChanges: [{ operation: "create", code: "Balkan Kingdom", name: "Balkan Kingdom" }],
    },
  };
  const result = attachUnionTerritoryTransfers({
    event,
    participants: [{ token: "Albania" }, { token: "Greece" }],
    regions: [
      { id: "AL.1", name: "Shkoder", country: "Albania" },
      { id: "GR.1", name: "Athens", country: "Greece" },
      { id: "TR.1", name: "Edirne", country: "Turkey" },
    ],
    targetPolity: "Balkan Kingdom",
  });
  assert.equal(result.transfers.length, 2);
  assert.deepEqual(
    event.impacts.regionTransfers.map(({ regionId, toCode }) => [regionId, toCode]),
    [["AL.1", "Balkan Kingdom"], ["GR.1", "Balkan Kingdom"]],
  );
  assert.equal(event.impacts.polityChanges[0].operation, "create");
});
