import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import area from "@turf/area";
import centroid from "@turf/centroid";
import { point } from "@turf/helpers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seedDir = path.join(root, "server", "seed", "default");
const baselineDir = path.join(root, "server", "seed", "1910", "open-historia-default");
const baselineSeedDir = path.join(baselineDir, "seed");
const baselineStampPath = path.join(baselineDir, "SOURCE_REVISION");
const historicalPath = path.join(root, "server", "seed", "1910", "source", "world_1914.geojson");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value, pretty = true) =>
  fs.writeFileSync(file, `${pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`);
const normalize = (value) => String(value || "").trim();

// Rebuild from an isolated, byte-for-byte snapshot of upstream's built-in seed.
// In-place generation is convenient while iterating but silently loses the
// baseline after the first run, making later generations non-reproducible.
const pristineSeedFiles = [
  "world.json",
  "game.json",
  "colors.json",
  "regions.geojson",
  "cities.geojson",
  "scenario.json",
];
for (const filename of pristineSeedFiles) {
  const baseline = path.join(baselineSeedDir, filename);
  if (!fs.existsSync(baseline)) {
    throw new Error(
      `Missing pristine Open Historia seed snapshot (${path.relative(root, baseline)}). ` +
      "Restore the tracked baseline instead of snapshotting generated 1910 output.",
    );
  }
  fs.copyFileSync(baseline, path.join(seedDir, filename));
}
const seedStatsPath = path.join(seedDir, "stats.json");
fs.rmSync(seedStatsPath, { force: true });
if (!fs.existsSync(baselineStampPath)) {
  throw new Error(`Missing upstream seed provenance marker: ${path.relative(root, baselineStampPath)}`);
}
const baselineRevision = normalize(fs.readFileSync(baselineStampPath, "utf8"));
if (!baselineRevision) throw new Error("The pristine Open Historia seed snapshot has no source revision.");

const world = readJson(path.join(seedDir, "world.json"));
const game = readJson(path.join(seedDir, "game.json"));
const scenario = readJson(path.join(seedDir, "scenario.json"));
const colors = readJson(path.join(seedDir, "colors.json"));
const regions = readJson(path.join(seedDir, "regions.geojson"));
const historical = readJson(historicalPath);
const existingCities = readJson(path.join(seedDir, "cities.geojson"));
const priorModernPolities = { ...(world.polityOverrides || {}) };
const originalOwnership = { ...(world.regionOwnershipOverrides || {}) };
const HISTORICAL_CITIES = [
  ["Санкт-Петербург", 30.3351, 59.9343, "Russian Empire", "capital", 1900000],
  ["Лондон", -0.1276, 51.5072, "United Kingdom", "capital", 7200000],
  ["Париж", 2.3522, 48.8566, "France", "capital", 2900000],
  ["Берлин", 13.405, 52.52, "German Empire", "capital", 2700000],
  ["Пекин", 116.4074, 39.9042, "Great Qing", "capital", 700000],
  ["Токио", 139.6917, 35.6895, "Japan", "capital", 2000000],
  ["Константинополь", 28.9784, 41.0082, "Ottoman Empire", "capital", 900000],
  ["Вена", 16.3738, 48.2082, "Austria-Hungary", "capital", 2000000],
  ["Рим", 12.4964, 41.9028, "Kingdom of Italy", "capital", 540000],
  ["Вашингтон", -77.0369, 38.9072, "United States", "capital", 330000],
  ["Оттава", -75.6972, 45.4215, "Canada", "capital", 90000],
  ["Калькутта", 88.3639, 22.5726, "British Raj", "capital", 1000000],
  ["Мадрид", -3.7038, 40.4168, "Spain", "capital", 600000],
  ["Амстердам", 4.9041, 52.3676, "Netherlands", "capital", 560000],
  ["Брюссель", 4.3517, 50.8503, "Belgium", "capital", 620000],
  ["Стокгольм", 18.0686, 59.3293, "Sweden", "capital", 350000],
  ["Христиания", 10.7522, 59.9139, "Norway", "capital", 230000],
  ["Копенгаген", 12.5683, 55.6761, "Denmark", "capital", 450000],
  ["Афины", 23.7275, 37.9838, "Greece", "capital", 170000],
  ["Белград", 20.4489, 44.7866, "Serbia", "capital", 90000],
  ["София", 23.3219, 42.6977, "Bulgaria", "capital", 70000],
  ["Бухарест", 26.1025, 44.4268, "Romania", "capital", 300000],
  ["Берн", 7.4474, 46.948, "Switzerland", "capital", 90000],
  ["Лиссабон", -9.1393, 38.7223, "Portugal", "capital", 430000],
  ["Буэнос-Айрес", -58.3816, -34.6037, "Argentina", "capital", 1200000],
  ["Рио-де-Жанейро", -43.2096, -22.9068, "Brazil", "capital", 900000],
  ["Мехико", -99.1332, 19.4326, "Mexico", "capital", 470000],
  ["Гавана", -82.3666, 23.1136, "Cuba", "capital", 300000],
  ["Тегеран", 51.389, 35.6892, "Iran", "capital", 280000],
  ["Кабул", 69.2075, 34.5553, "Afghanistan", "capital", 60000],
  ["Бангкок", 100.5018, 13.7563, "Thailand", "capital", 600000],
  ["Батавия", 106.8456, -6.2088, "Netherlands Indies", "capital", 160000],
  ["Ханой", 105.8342, 21.0278, "French Indo-China", "capital", 120000],
  ["Каир", 31.2357, 30.0444, "Egypt", "city", 650000],
  ["Александрия", 29.9187, 31.2001, "Egypt", "port", 320000],
  ["Мумбаи", 72.8777, 19.076, "British Raj", "port", 850000],
  ["Шанхай", 121.4737, 31.2304, "Great Qing", "port", 1300000],
  ["Осака", 135.5023, 34.6937, "Japan", "city", 1200000],
  ["Нью-Йорк", -74.006, 40.7128, "United States", "port", 4700000],
  ["Суэц", 32.5498, 29.9668, "Egypt", "landmark", 18000],
  ["Порт-Артур", 121.63, 38.87, "Russian Empire", "port", 30000],
];

const historicName = new Map([
  ["Manchu Empire", "Great Qing"],
  ["Russian Empire", "Russian Empire"],
  ["United Kingdom of Great Britain and Ireland", "United Kingdom"],
  ["Empire of Japan", "Japan"],
  ["Austria Hungary", "Austria-Hungary"],
  ["Austro-Hungarian Empire", "Austria-Hungary"],
  ["French Indo-China", "French Indochina"],
  ["French Indo-China (Fr)", "French Indochina"],
]);
const HISTORIC_MATCH_ALIASES = new Map([
  ["Russian Federation", "Russian Empire"],
  ["Russia", "Russian Empire"],
  ["China", "Great Qing"],
  ["Germany", "German Empire"],
  ["Italy", "Kingdom of Italy"],
  ["Korea", "Korea"],
]);
const HISTORIC_REGION_OWNER_OVERRIDES = Object.freeze({
  Dalian: "Japan",
  "Western Istanbul": "Ottoman Empire",
});

const explicitColors = {
  "Russian Empire": "#36834d",
  "Russia": "#36834d",
  "Great Qing": "#d6b03a",
  "British Raj": "#bb4b46",
  "United Kingdom": "#b9423e",
  "German Empire": "#787a73",
  "France": "#4778a5",
  "Empire of Japan": "#c77a68",
  "Japan": "#c77a68",
  "Ottoman Empire": "#91735b",
  "Austria-Hungary": "#b49a66",
  "Kingdom of Italy": "#598b5a",
  "Italy": "#598b5a",
  "Belgium": "#c3a632",
  "Netherlands": "#bd7543",
  "United States": "#547e9c",
  "Canada": "#cc7164",
  "Brazil": "#4f8d62",
};

// Pax Historia's world labels are part of the map itself; localize historical
// polity names in the scenario data, not in a detached UI legend.
const HISTORICAL_LABELS_RU = {
  Abyssinia: "Абиссиния",
  Afghanistan: "Афганистан",
  Albania: "Албания",
  Algeria: "Алжир",
  Argentina: "Аргентина",
  "Austria-Hungary": "Австро-Венгрия",
  "Austro-Hungarian Empire": "Австро-Венгерская империя",
  "Belgian Congo": "Бельгийское Конго",
  Belgium: "Бельгия",
  Brazil: "Бразилия",
  "British East Africa": "Британская Восточная Африка",
  "British Protectorate": "Британский протекторат",
  "British Raj": "Британская Индия",
  "British Somaliland": "Британское Сомали",
  Bulgaria: "Болгария",
  Canada: "Канада",
  Chile: "Чили",
  China: "Китай",
  Cuba: "Куба",
  Denmark: "Дания",
  Egypt: "Египет",
  France: "Франция",
  "French Equatorial Africa": "Французская Экваториальная Африка",
  "French Guiana": "Французская Гвиана",
  "French Indo-China": "Французский Индокитай",
  "French Indochina": "Французский Индокитай",
  "French West Africa": "Французская Западная Африка",
  "German E. Africa (Tanganyika)": "Германская Восточная Африка",
  "German Empire": "Германская империя",
  "German South-West Africa": "Германская Юго-Западная Африка",
  Germany: "Германия",
  "Great Qing": "Империя Цин",
  Greece: "Греция",
  Iran: "Персия",
  Italy: "Италия",
  Japan: "Япония",
  "Kingdom of Italy": "Королевство Италия",
  "Madagascar (France)": "Мадагаскар",
  Mexico: "Мексика",
  Montenegro: "Черногория",
  Morocco: "Марокко",
  Netherlands: "Нидерланды",
  "Netherlands Indies": "Нидерландская Ост-Индия",
  "New Zealand": "Новая Зеландия",
  Norway: "Норвегия",
  "Ottoman Empire": "Османская империя",
  Persia: "Персия",
  Portugal: "Португалия",
  Romania: "Румыния",
  Russia: "Россия",
  "Russian Empire": "Российская империя",
  Serbia: "Сербия",
  Spain: "Испания",
  Sweden: "Швеция",
  Switzerland: "Швейцария",
  Thailand: "Сиам",
  Tibet: "Тибет",
  "United Kingdom": "Великобритания",
  "United States": "США",
};

const toHex = (rgb) => `#${rgb.map((value) => Math.max(0, Math.min(255, Number(value) || 0)).toString(16).padStart(2, "0")).join("")}`;
const asRgb = (hex) => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];
const hashColorOffset = (text) => [...text].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7) % 15 - 7;
const colorFor = (name, subject, priorPolityColors = {}) => {
  if (explicitColors[name]) return explicitColors[name];
  if (priorPolityColors[subject]?.color) return priorPolityColors[subject].color;
  if (colors[name]) return toHex(colors[name]);
  if (colors[subject]) return toHex(colors[subject]);
  const base = asRgb("#8b8e78");
  const offset = hashColorOffset(name);
  return toHex(base.map((channel) => channel + offset));
};

const namedHistoricalFeatures = historical.features.filter((feature) => (
  feature.geometry && normalize(feature.properties?.NAME || feature.properties?.ABBREVN)
));
const historicalFeatures = historical.features
  .filter((feature) => feature.geometry)
  .flatMap((feature, index) => {
    let attributed = feature;
    if (!normalize(feature.properties?.NAME || feature.properties?.ABBREVN)) {
      // The source has a few islands/split polygons without properties. Retain
      // them when their interior belongs to a named historical polygon.
      try {
        const sample = centroid(feature);
        const containing = namedHistoricalFeatures
          .filter((candidate) => {
            try { return booleanPointInPolygon(sample, candidate); } catch { return false; }
          })
          .sort((a, b) => area(a) - area(b))[0];
        if (!containing) return [];
        attributed = { ...feature, properties: { ...containing.properties } };
      } catch {
        return [];
      }
    }
    return [attributed];
  })
  .map((feature, index) => {
    const sourceName = normalize(feature.properties?.NAME || feature.properties?.ABBREVN);
    const displayName = historicName.get(sourceName) || sourceName;
    const subjectSource = normalize(feature.properties?.SUBJECTO);
    const subject = historicName.get(subjectSource) || subjectSource;
    const color = colorFor(displayName, subject, world.polityOverrides || {});
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const walk = (coordinates) => {
      if (typeof coordinates?.[0] === "number") {
        bounds[0] = Math.min(bounds[0], coordinates[0]);
        bounds[1] = Math.min(bounds[1], coordinates[1]);
        bounds[2] = Math.max(bounds[2], coordinates[0]);
        bounds[3] = Math.max(bounds[3], coordinates[1]);
        return;
      }
      for (const child of coordinates || []) walk(child);
    };
    walk(feature.geometry.coordinates);
    return { feature, index, sourceName, displayName, subject, color, area: area(feature), bounds };
  });

const palettePolities = {};
for (const item of historicalFeatures) {
  const prior = palettePolities[item.displayName];
  palettePolities[item.displayName] = {
    ...(prior || world.polityOverrides?.[item.displayName] || {}),
    code: item.displayName,
    name: item.displayName,
    aliases: [...new Set([
      ...(prior?.aliases || []),
      item.sourceName,
      item.subject && item.subject !== item.displayName ? item.subject : "",
    ].filter(Boolean))],
    status: "active",
    color: item.color,
    note: item.subject && item.subject !== item.displayName
      ? `Зависимая историческая территория державы «${item.subject}» (карта 1914 года).`
      : (prior?.note || ""),
  };
}
for (const [sourceOwner, prior] of Object.entries(priorModernPolities)) {
  const owner = HISTORIC_MATCH_ALIASES.get(sourceOwner) || sourceOwner;
  if (palettePolities[owner]) {
    const current = palettePolities[owner];
    current.aliases = [...new Set([
      ...(current.aliases || []),
      sourceOwner,
      ...(prior.aliases || []),
      ...(prior.formerNames || []),
    ].filter(Boolean))];
    continue;
  }
  palettePolities[owner] = {
    ...prior,
    code: owner,
    name: HISTORICAL_LABELS_RU[owner] || prior.name || owner,
    aliases: [...new Set([
      sourceOwner,
      ...(prior.aliases || []),
      ...(prior.formerNames || []),
    ].filter(Boolean))],
    status: prior.status || "active",
    color: explicitColors[owner] || prior.color || colorFor(sourceOwner, sourceOwner, priorModernPolities),
  };
}

function interiorPoint(regionFeature) {
  try {
    const center = centroid(regionFeature);
    if (booleanPointInPolygon(center, regionFeature)) return center;
  } catch {
    // Some concave administrative shapes have a centroid outside their border.
  }
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (coordinates) => {
    if (typeof coordinates?.[0] === "number") {
      bounds[0] = Math.min(bounds[0], coordinates[0]);
      bounds[1] = Math.min(bounds[1], coordinates[1]);
      bounds[2] = Math.max(bounds[2], coordinates[0]);
      bounds[3] = Math.max(bounds[3], coordinates[1]);
      return;
    }
    for (const child of coordinates || []) walk(child);
  };
  walk(regionFeature.geometry?.coordinates);
  if (!bounds.every(Number.isFinite)) return null;
  for (let divisions = 8; divisions <= 64; divisions *= 2) {
    for (let y = 0; y <= divisions; y++) {
      for (let x = 0; x <= divisions; x++) {
        const lon = bounds[0] + (bounds[2] - bounds[0]) * ((x + 0.37) / (divisions + 0.74));
        const lat = bounds[1] + (bounds[3] - bounds[1]) * ((y + 0.41) / (divisions + 0.82));
        const candidate = point([lon, lat]);
        if (booleanPointInPolygon(candidate, regionFeature)) return candidate;
      }
    }
  }
  return null;
}

function historicalOwner(regionFeature) {
  const center = interiorPoint(regionFeature);
  if (!center) return null;
  const p = center;
  let best = null;
  for (const item of historicalFeatures) {
    try {
      const [minLon, minLat, maxLon, maxLat] = item.bounds;
      const [lon, lat] = center.geometry.coordinates;
      if (lon < minLon || lon > maxLon || lat < minLat || lat > maxLat) continue;
      if (!booleanPointInPolygon(p, item.feature)) continue;
      // Smaller nested polygons are the source's more specific polity:
      // Mongolia, Tibet and named colonies retain separate owners even inside
      // a larger empire's map extent.
      if (!best || item.area < best.area) best = item;
    } catch {
      // An invalid historical source feature is ignored; the canonical
      // Open Historia owner remains as a safe fallback.
    }
  }
  if (!best) return null;

  // Keep separate named colonial/political territories as map owners, while
  // marking their historical subject in polity metadata and inheriting colors.
  const shortAdmin = /\((RU|GB|FR|DE|NL|IT)\)$/i.test(best.sourceName);
  if (shortAdmin && best.subject) return best.subject;
  return HISTORIC_MATCH_ALIASES.get(best.displayName) || best.displayName;
}

const historicalOwnership = {};
let reassigned = 0;
for (const feature of regions.features) {
  const id = normalize(feature.properties?.id);
  if (!id) continue;
  const matchedHistoricalOwner = historicalOwner(feature);
  const mapRegionName = normalize(feature.properties?.name);
  const historicalPoint = matchedHistoricalOwner ? null : interiorPoint(feature);
  const originalOwner = normalize(originalOwnership[id]) || normalize(feature.properties.owner);
  const neutralAntarctica = !matchedHistoricalOwner
    && originalOwner === "Unclaimed"
    && Number(historicalPoint?.geometry?.coordinates?.[1]) < -55;
  const owner = HISTORIC_REGION_OWNER_OVERRIDES[mapRegionName]
    || (neutralAntarctica ? "Antarctica"
      : HISTORIC_MATCH_ALIASES.get(matchedHistoricalOwner || "")
    || matchedHistoricalOwner
    || HISTORIC_MATCH_ALIASES.get(normalize(originalOwnership[id]))
    || normalize(originalOwnership[id])
    || HISTORIC_MATCH_ALIASES.get(normalize(feature.properties.owner))
    || normalize(feature.properties.owner)
      || "Unclaimed");
  if (!palettePolities[owner]) {
    const prior = priorModernPolities[owner] || {};
    const fallbackColor = prior.color || (colors[owner] ? toHex(colors[owner]) : "#8b8e78");
    palettePolities[owner] = {
      ...prior,
      code: owner,
      name: prior.name || owner,
      aliases: [...new Set([...(prior.aliases || []), owner])],
      status: "active",
      color: owner === "Antarctica" ? "#7b8790" : fallbackColor,
      ...(owner === "Antarctica" ? { note: "Континент без суверенного владельца на начало 1910 года." } : {}),
    };
  }
  historicalOwnership[id] = owner;
  feature.properties.owner = owner;
  feature.properties.ownerCode = owner;
  reassigned++;
}

// Retain all the original GADM regions and IDs. Only their starting owners,
// polity metadata and the scenario start date are replaced for this campaign.
world.regionOwnershipOverrides = historicalOwnership;
world.regionSovereigntyOverrides = {};
world.polityOverrides = palettePolities;
delete world.statsSheet;
world.allowedUnitTypes = ["infantry", "cavalry", "naval", "garrison"];
world.ownerCodes = [...new Set([
  ...Object.keys(palettePolities),
  ...Object.values(historicalOwnership),
])].sort((a, b) => a.localeCompare(b));
world.ownerSchema = 4;
world.language = "Russian";
world.customRegions = true;
world.mapCredit = [
  "Open Historia (AGPL-3.0-or-later), default GADM region geometry and scenario architecture.",
  "Historical boundaries: Historical Basemaps, world_1914.geojson (GPL-3.0), used as a gameplay approximation for 1910.",
  "GADM administrative geography © GADM; redistributed as part of the Open Historia seed. Review GADM terms for public/commercial deployment.",
].join("\n");
world.startingTimelineText =
  "Начало альтернативной истории — 1 января 1910 года. Мир и исторические границы регионов заданы этим сценарием. " +
  "Игрок определяет курс управляемой державы: не совершай за неё решений и не объявляй её действия без приказа игрока. " +
  "Другие страны могут реагировать на приказы игрока, договоры и уже случившиеся события. Тихий ход без выдуманных кризисов — нормален. " +
  "Меняй контроль только существующих регионов; не создавай новые страны, регионы и города без прямой просьбы игрока.";
world.simulationRules = [
  "Это управляемая игроком песочница. Не принимай решений, не отдавай приказов и не начинай войн от имени державы игрока без её прямого указания.",
  "События показывают исполнение приказов игрока и правдоподобные реакции других держав; не выдумывай кризисы лишь для заполнения хода. Спокойный ход допустим.",
  "Карта меняется только как следствие решения игрока, согласованной дипломатии или обоснованной реакции на уже описанное событие.",
  "Используй только существующие территории и их ID. Новые страны, столицы и города создавай только по прямой просьбе игрока.",
  "Не добавляй экономические показатели, ресурсы, производство, снабжение или числовые игровые модели.",
].join("\n");
world.builtInMap = `pax-historia-world-1910-${baselineRevision}`;
world.builtInRevision = 2;
world.basemap = "ocean";

const newColors = {};
for (const [name, polity] of Object.entries(world.polityOverrides)) {
  if (polity.color) newColors[name] = asRgb(polity.color);
}

game.country = "United Kingdom";
game.startDate = "1910-01-01";
game.gameDate = "1910-01-01";
game.difficulty = "standard";
game.language = "Russian";

scenario.name = "Мир 1910";
scenario.eyebrow = "ИСТОРИЧЕСКАЯ ПЕСОЧНИЦА";
scenario.heroTitle = "Мир на пороге перемен";
scenario.heroSubtitle = "Начните 1 января 1910 года. Империи, колонии и державы меняют историю по вашим решениям.";
scenario.subtitle = "Open Historia · карта регионов · старт 1910";
scenario.description =
  `Кампания начинается 1 января 1910 года. Карта Open Historia содержит ${regions.features.length.toLocaleString("ru-RU")} редактируемых регионов и исторические владения, приближённые к 1914 году.`;
scenario.createdAt ||= "2026-10-12T00:00:00.000Z";
scenario.updatedAt = scenario.createdAt;
scenario.game = {
  ...scenario.game,
  country: "United Kingdom",
  startDate: "1910-01-01",
  gameDate: "1910-01-01",
  language: "Russian",
};
scenario.countryNameOverrides = {
  ...(scenario.countryNameOverrides || {}),
  "Russian Empire": "Российская империя",
  "Great Qing": "Империя Цин",
  "British Raj": "Британская Индия",
  "United Kingdom": "Великобритания",
  "German Empire": "Германская империя",
};
for (const [owner, name] of Object.entries(HISTORICAL_LABELS_RU)) {
  if (world.polityOverrides[owner]) scenario.countryNameOverrides[owner] = name;
}

const capitalFeatures = HISTORICAL_CITIES.map(([name, lon, lat, owner, type, population]) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: {
    city: name,
    name,
    owner,
    population,
    capital: type === "capital" ? "primary" : "",
    tier: type === "capital" ? 3 : 2,
    type,
  },
}));
const curatedCapitalPoints = HISTORICAL_CITIES
  .filter(([, , , type]) => type === "capital")
  .map(([, lng, lat]) => [lng, lat]);
const inheritedCities = existingCities.features.filter((feature) => {
  if (feature.properties?.capital !== "primary") return true;
  const coordinates = feature.geometry?.coordinates ?? [];
  return !curatedCapitalPoints.some(([lng, lat]) => (
    Math.hypot(Number(coordinates[0]) - lng, Number(coordinates[1]) - lat) < 0.05
  ));
});
for (const feature of inheritedCities) {
  if (feature.properties?.capital === "primary") {
    feature.properties.capital = "";
    feature.properties.tier = Math.min(Number(feature.properties.tier) || 2, 2);
  }
}
const citiesGeojson = {
  type: "FeatureCollection",
  features: [...capitalFeatures, ...inheritedCities],
};
const regionBounds = regions.features.map((region) => {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (coordinates) => {
    if (typeof coordinates?.[0] === "number") {
      bounds[0] = Math.min(bounds[0], coordinates[0]);
      bounds[1] = Math.min(bounds[1], coordinates[1]);
      bounds[2] = Math.max(bounds[2], coordinates[0]);
      bounds[3] = Math.max(bounds[3], coordinates[1]);
      return;
    }
    for (const child of coordinates || []) visit(child);
  };
  visit(region.geometry?.coordinates);
  return { region, bounds };
});
for (const feature of citiesGeojson.features) {
  const properties = feature?.properties;
  if (!properties || typeof properties !== "object") continue;
  const city = HISTORICAL_CITIES.find(([name]) => (
    name === normalize(properties.city ?? properties.name)
  ));
  if (!city) continue;
  const [name, lng, lat, owner, type, population] = city;
  const coordinates = feature.geometry?.coordinates ?? [];
  if (Math.hypot(Number(coordinates[0]) - lng, Number(coordinates[1]) - lat) > 0.05) continue;
  properties.city = name;
  properties.name = name;
  properties.owner = owner;
  properties.ownerCode = owner;
  properties.population = population;
  properties.capital = type === "capital" ? "primary" : "";
  properties.tier = type === "capital" ? 3 : 2;
  properties.type = type;
}
for (const feature of citiesGeojson.features) {
  const properties = feature?.properties;
  if (!properties || typeof properties !== "object") continue;
  const coordinates = feature.geometry?.coordinates ?? [];
  if (coordinates.length < 2 || !coordinates.slice(0, 2).every(Number.isFinite)) continue;
  const [lng, lat] = coordinates;
  const containingRegion = regionBounds.find(({ region, bounds }) => (
    lng >= bounds[0]
    && lng <= bounds[2]
    && lat >= bounds[1]
    && lat <= bounds[3]
    && booleanPointInPolygon(point([lng, lat]), region)
  ))?.region;
  const assigned = containingRegion
    ? historicalOwnership[normalize(containingRegion.properties?.id)]
    : historicalOwner({
      type: "Feature",
      properties: {},
      geometry: { type: "Point", coordinates: [lng, lat] },
    });
  if (assigned) {
    properties.owner = assigned;
    properties.ownerCode = assigned;
  }
}

writeJson(path.join(seedDir, "regions.geojson"), regions, false);
writeJson(path.join(seedDir, "world.json"), world);
writeJson(path.join(seedDir, "game.json"), game);
writeJson(path.join(seedDir, "colors.json"), newColors);
fs.rmSync(seedStatsPath, { force: true });
writeJson(path.join(seedDir, "scenario.json"), scenario);
writeJson(path.join(seedDir, "cities.geojson"), citiesGeojson, false);

console.log(JSON.stringify({
  scenario: scenario.name,
  date: game.startDate,
  regions: regions.features.length,
  historicalAssignments: reassigned,
  historicalPolities: Object.keys(palettePolities).length,
  unassignedRegions: regions.features.length - reassigned,
  sourceFallbackRegions: regions.features.filter((feature) => !historicalOwner(feature)).length,
  retainedOriginalOwners: Object.keys(originalOwnership).length,
}, null, 2));
