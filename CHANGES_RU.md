# Изменения Pax Historia и обоснование

Этот документ перечисляет изменения текущего рабочего дерева относительно
исходного коммита `6d2dc33` (ветка `pax-1910-from-open-historia`). Он нужен
для форка/публикации и объясняет, зачем менялись затронутые части. Не включает
локальные `.env`, сохранения Docker и отдельный каталог `valheim-skyforge-mod`.

## 1. Кампания «Мир 1910»

**Зачем:** дать проекту воспроизводимую стартовую кампанию 1910 года и не
подменять исходные данные незадокументированными ручными файлами.

- `scripts/seed-world-1910.mjs` создаёт исторический сценарий из зафиксированного
  исходного seed и атрибутированных географических данных.
- `server/seed/1910/open-historia-default/` хранит исходный seed Open Historia
  для сравнения и воспроизводимости.
- `server/seed/1910/source/` содержит источник карты и его лицензию/атрибуцию.
- `server/seed/default/{cities.geojson,colors.json,game.json,regions.geojson,scenario.json,world.json}`
  обновлены под новую кампанию.
- `server/seed/default/scenario-data-placeholder.txt` поддерживает комплектность
  seed-ресурсов.
- `server/builtInScenarioSeed.test.js` проверяет установку, миграцию старых
  сценариев, сохранение пользовательских копий и идемпотентность.
- `docs/assets-and-data.md`, `scripts/fetch-map-assets.mjs`, `README.md`,
  `.gitignore`, `package.json` описывают новый источник, генерацию и сборку.

## 2. Исполнение приказов и перемотка

**Зачем:** приказ игрока не должен исчезать между рассказом ИИ и каноническим
состоянием мира; сложные/длинные перемотки должны корректно сохраняться и
применяться по частям без потери даты, операций и очереди.

- `src/Game/AI/gameplay.js` — связывание приказов с событиями, проверка
  территориальных последствий, детерминированные макро-передачи, примирение
  войн/дипломатии и применение объединений.
- `src/Game/AI/defaultPrompts.json`, `promptContext.js`, `promptGuidance.js`,
  `shippedGuidance.js`, `public/lang/prompts/ru.json` — согласование правил
  симуляции и локализованных инструкций.
- `src/Game/AI/orderText.js` нормализует падежи, транслитерацию, смешанную
  кириллицу/латиницу и небольшие опечатки в приказах.
- `src/Game/AI/unionTerritory.js` выводит участников реального объединения и
  создаёт юридические передачи из их регионов новому государству.
- `src/Game/AI/nativeTerritoryDirector.js`, `nativeWorldIntegrity.js`,
  `nativeWarLedger.js`, `nativeTimelineCurator.js`, `worldDirection.js`
  усиливают контроль причинности, территориальных операций, статуса войны и
  сохранности значимых событий.
- `src/Game/AI/gameplaySchemas.js`, `jumpSegments.js`, `main.jsx`,
  `placement.js`, `providerConfig.js`, `providerErrors.js` — схемы результата,
  сегменты перемотки, размещение и устойчивость к ошибкам провайдера.
- `src/runtime/gameState.js`, `diplomaticEnvelope.js`, `eventDedup.js`,
  `projects.js`, `ownerNames.js`, `translator.js`, `preload.js`,
  `web/storeConstants.js` — применение/сохранение состояния, идентичность,
  дедупликация и совместимость runtime.
- Регрессионные тесты: `foldedSkip.test.js`, `jumpPromptCraft.test.js`,
  `jumpSegments.test.js`, `gameplaySchemasCustomStats.test.js`,
  `nativeTerritoryDirector.state.test.js`, `nativeTimelineCurator.gate.test.js`,
  `warLedger.test.js`, `placement.test.js`, `placementPass.test.js`,
  `providerConfig.test.js`, `providerErrors.test.js`, `eventDedup.test.js`,
  `gameState.ownerIdentity.test.js`, `gameState.territoryBasis.test.js`,
  `gameState.unitMotion.test.js`, `gameState.unitOrders.test.js`,
  `orderText.test.js`, `unionTerritory.test.js`.

### Территориальные макроприказы

Приказы вроде «передать Германии все спорные территории» применяются только
к регионам, которые одновременно:

1. есть в текущем каталоге карты;
2. имеют указанную страну среди текущих претендентов;
3. сейчас контролируются игроком.

Для явного списка регионов используется список из приказа, а не расширение
до всех претензий. Исключения, например «кроме Luban», вычитаются из множества.
Неизвестный получатель, отсутствующие претензии и пустой результат не должны
создавать фиктивные передачи.

### Объединение государств

Запись `polityChanges: create` только создаёт государство в реестре; сама по
себе она не переносит границы и не даёт ему регионов. Для события о фактическом
объединении движок распознаёт названных участников, разрешает их текущие
идентичности и передаёт регионы, законным сувереном которых они являются,
новому государству через `regionTransfers` с основанием `unification`.
Отрицания и отдельно исключённые страны не включаются; регионы с другим
сувереном не отбираются лишь из-за текущего военного контроля.

## 3. Карта и территориальная перерисовка

**Зачем:** не строить дорогую геометрию направленного sweep для сотен регионов
и показывать изменение цвета мягким переходом, сохраняя канонические
региональные обновления и интерактивность.

- `src/Game/Map/Nations.jsx` использует лёгкий fade для массового перехода цвета.
- `src/Game/Map/vnext/polityBoundariesWorker.js` выбирает формат перехода и
  вычисляет только необходимую transition metadata.
- `politicalCartographyLifecycle.js` сохраняет корректное coalescing обновлений.
- `politicalCartographyArchitecture.test.js`,
  `politicalCartographyLifecycle.test.js`,
  `polityBoundariesWorkerProtocol.test.js` фиксируют инварианты слоя и worker.
- `ownershipFloodCustomLayer.js`, `PolityTextLayer.jsx`,
  `polityTextCustomLayer.js`, `src/Game/Selection/Regions.jsx` содержат
  сопутствующие исправления слоя карты/выбора.

## 4. Дипломатия и игровые данные

**Зачем:** сохранять согласованные дипломатические сведения и корректно
представлять их в симуляции и интерфейсе.

- `src/Game/AI/diplomaticProgress.js` и `diplomaticProgress.test.js` — правила
  продвижения и завершения дипломатических сюжетов.
- `src/Game/AI/pregamePolityIdentity.js` и тесты `pregamePolityIdentity.test.js`,
  `pregameHistory.test.js` — идентичность государств и предыстория кампании.
- `src/runtime/patrolStation.test.js`, `src/Game/AI/warLedger.test.js`,
  `server/diplomaticEnvelope.test.js`, `server/boardAndStorylines.test.js`
  закрепляют смежные сценарии.

## 5. Сервер, локальный запуск и безопасность

**Зачем:** иметь локальную сборку через Docker, обслуживать карту и сценарии,
а также проверять входные данные и серверные операции.

- `Dockerfile`, `docker-compose.yml`, `.dockerignore` — production-контейнер
  и локальный запуск.
- `server/server.js`, `libraryStore.js`, `security.js`, `polityRename.js` —
  серверные маршруты, хранилище, безопасность и переименование государств.
- `server/security.test.js`, `polityRename.test.js`,
  `polityLabels.realGeometry.test.js` — соответствующие проверки.
- `server/test-fixtures/modern-day-regions.geojson` — географический fixture.

## 6. Интерфейс и русский язык

**Зачем:** сделать тексты интерфейса, настройки и экран запуска пригодными для
русскоязычной кампании.

- `index.html`, `src/runtime/i18n.js`, `src/runtime/StartupScreen.jsx`,
  `src/Game/GameUI/{libraryBar,settings,time}.jsx` — язык, настройки и экран игры.
- `src/Game/AI/defaultPrompts.json`, `public/lang/prompts/ru.json` —
  русские инструкции для ИИ, не только подписи интерфейса.
- `README.md` и `READMEru.md` — описание проекта на английском/русском языках.

## 7. Проверки

На момент подготовки списка полный набор тестов проходит: **2940 passed,
0 failed** (2 skipped, 2 todo). Production build проверяется командой
`npm run build`. Для CI/публикации следует запускать эти команды повторно на
финальном содержимом форка.

## Исключённые локальные данные

- `.env` и другие секреты/ключи не включать в публикацию.
- `recovery/current-seed-2026-10-12/` — локальная резервная копия seed; публиковать
  только при отдельном решении о её назначении и атрибуции.
- `valheim-skyforge-mod/` — отдельная посторонняя работа, не часть этого проекта.

## Полный список файлов этой публикации

Полный перечень вошедших в подготовленный коммит файлов (локальные recovery/ и отдельный valheim-skyforge-mod/ сюда не включены):

- CHANGES_RU.md — этот список и обоснование

- `.dockerignore`
- `.gitignore`
- `Dockerfile`
- `README.md`
- `READMEru.md`
- `docker-compose.yml`
- `docs/assets-and-data.md`
- `index.html`
- `package.json`
- `public/lang/prompts/ru.json`
- `scripts/fetch-map-assets.mjs`
- `scripts/seed-world-1910.mjs`
- `server/boardAndStorylines.test.js`
- `server/builtInScenarioSeed.test.js`
- `server/libraryStore.js`
- `server/polityLabels.realGeometry.test.js`
- `server/polityRename.js`
- `server/polityRename.test.js`
- `server/security.js`
- `server/security.test.js`
- `server/seed/1910/open-historia-default/ATTRIBUTION.txt`
- `server/seed/1910/open-historia-default/SOURCE_REVISION`
- `server/seed/1910/open-historia-default/seed/cities.geojson`
- `server/seed/1910/open-historia-default/seed/colors.json`
- `server/seed/1910/open-historia-default/seed/game.json`
- `server/seed/1910/open-historia-default/seed/regions.geojson`
- `server/seed/1910/open-historia-default/seed/scenario.json`
- `server/seed/1910/open-historia-default/seed/stats.json`
- `server/seed/1910/open-historia-default/seed/world.json`
- `server/seed/1910/source/ATTRIBUTION.txt`
- `server/seed/1910/source/LICENSE-GPL-3.0.txt`
- `server/seed/1910/source/world_1914.geojson`
- `server/seed/default/cities.geojson`
- `server/seed/default/colors.json`
- `server/seed/default/game.json`
- `server/seed/default/regions.geojson`
- `server/seed/default/scenario-data-placeholder.txt`
- `server/seed/default/scenario.json`
- `server/seed/default/world.json`
- `server/server.js`
- `server/test-fixtures/modern-day-regions.geojson`
- `src/Game/AI/defaultPrompts.json`
- `src/Game/AI/diplomaticProgress.js`
- `src/Game/AI/diplomaticProgress.test.js`
- `src/Game/AI/foldedSkip.test.js`
- `src/Game/AI/gameplay.js`
- `src/Game/AI/gameplaySchemas.js`
- `src/Game/AI/gameplaySchemasCustomStats.test.js`
- `src/Game/AI/jumpPromptCraft.test.js`
- `src/Game/AI/jumpSegments.js`
- `src/Game/AI/jumpSegments.test.js`
- `src/Game/AI/main.jsx`
- `src/Game/AI/nativeTerritoryDirector.js`
- `src/Game/AI/nativeTerritoryDirector.state.test.js`
- `src/Game/AI/nativeTimelineCurator.gate.test.js`
- `src/Game/AI/nativeTimelineCurator.js`
- `src/Game/AI/nativeWarLedger.js`
- `src/Game/AI/nativeWorldIntegrity.js`
- `src/Game/AI/orderText.js`
- `src/Game/AI/orderText.test.js`
- `src/Game/AI/placement.js`
- `src/Game/AI/placement.test.js`
- `src/Game/AI/placementPass.test.js`
- `src/Game/AI/pregameHistory.test.js`
- `src/Game/AI/pregamePolityIdentity.js`
- `src/Game/AI/pregamePolityIdentity.test.js`
- `src/Game/AI/promptContext.js`
- `src/Game/AI/promptGuidance.js`
- `src/Game/AI/providerConfig.js`
- `src/Game/AI/providerConfig.test.js`
- `src/Game/AI/providerErrors.js`
- `src/Game/AI/providerErrors.test.js`
- `src/Game/AI/shippedGuidance.js`
- `src/Game/AI/unionTerritory.js`
- `src/Game/AI/unionTerritory.test.js`
- `src/Game/AI/warLedger.test.js`
- `src/Game/AI/worldDirection.js`
- `src/Game/GameUI/libraryBar.jsx`
- `src/Game/GameUI/settings.jsx`
- `src/Game/GameUI/time.jsx`
- `src/Game/Map/Nations.jsx`
- `src/Game/Map/labels/PolityTextLayer.jsx`
- `src/Game/Map/labels/polityTextCustomLayer.js`
- `src/Game/Map/vnext/ownershipFloodCustomLayer.js`
- `src/Game/Map/vnext/politicalCartographyArchitecture.test.js`
- `src/Game/Map/vnext/politicalCartographyLifecycle.js`
- `src/Game/Map/vnext/politicalCartographyLifecycle.test.js`
- `src/Game/Map/vnext/polityBoundariesWorker.js`
- `src/Game/Map/vnext/polityBoundariesWorkerProtocol.test.js`
- `src/Game/Selection/Regions.jsx`
- `src/runtime/StartupScreen.jsx`
- `src/runtime/eventDedup.js`
- `src/runtime/eventDedup.test.js`
- `src/runtime/gameState.js`
- `src/runtime/gameState.ownerIdentity.test.js`
- `src/runtime/gameState.territoryBasis.test.js`
- `src/runtime/gameState.unitOrders.test.js`
- `src/runtime/ownerNames.js`
- `src/runtime/patrolStation.test.js`
- `src/runtime/preload.js`
- `src/runtime/projects.js`
- `src/runtime/translator.js`
- `src/runtime/web/storeConstants.js`
