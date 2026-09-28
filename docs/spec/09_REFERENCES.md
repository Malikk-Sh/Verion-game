# Источники и границы заимствования

Проверка для GDD 1.0: 28.09.2026. Источники задают основания; конкретные игровые числа, рецепты, масштабы и архитектурные бюджеты выбраны для Vireon и не приписываются источникам. Исходники Ad Astra прочитаны локально, игра с модом не запускалась. Никакие результаты Three.js на целевых телефонах пока не измерены.

## Наука

- **S1. [NASA: Mars Terraforming Not Possible Using Present-Day Technology](https://www.nasa.gov/news-release/mars-terraforming-not-possible-using-present-day-technology/).** Ограничения доступного CO₂ реального Марса. Обоснование для вымышленной системы с заданными запасами; не доказательство реализуемости наших машин.
- **S2. [NASA: Environmental Control and Life Support Systems](https://www.nasa.gov/reference/environmental-control-and-life-support-systems-eclss/).** Связанные задачи воздуха, воды, очистки и кислородного производства. Раздельные вода/O₂ и расход энергии имеют научное основание; наша компактная зона/буфер — упрощение.
- **S3. [NASA: MOXIE Completes Mars Mission](https://www.nasa.gov/missions/mars-2020-perseverance/perseverance-rover/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/).** Пример получения O₂ из местного CO₂; не переносится как доказательство готового планетарного терраформирования.
- **S4. [NASA Earth Observatory: The Carbon Cycle](https://science.nasa.gov/earth/earth-observatory/the-carbon-cycle/).** Связь фотосинтеза, биомассы и углерода; объясняет необходимость материальных входов биореактора.
- **S5. [NASA: What Is Microgravity?](https://www.nasa.gov/centers-and-facilities/glenn/what-is-microgravity/).** Совместное свободное падение. Игровой вектор к ближайшей планете на астероиде намеренно не выдаётся за точную относительную орбитальную динамику.
- **S6. [IEA: Cement](https://www.iea.org/reports/cement-3).** Высокотемпературная переработка минерального сырья может выделять углеродный газ. Наше фиксированное газоносное сырьё и GU — абстракция без подробной химии.

Астероидные буксиры, магнитные лучи и магнитный щит исключены из действующего каталога. Старые ссылки на концепции в исследовании сохранены для истории, не являются обязательствами разработки.

## Ad Astra — первичные данные

Срез: **1.15.21 / Minecraft 1.20.1**, commit `5a986665e1d91e31c50321ff225a3fb23558ff35`. Полный разбор: [исследование](../research/Ad_Astra_Research_RU.md).

- [Astrodux: Space Station](https://github.com/terrarium-earth/Ad-Astra/blob/5a986665e1d91e31c50321ff225a3fb23558ff35/common/src/main/resources/assets/ad_astra/patchouli_books/astrodux/en_us/entries/the_moon/space_station.json) — готовая расширяемая орбитальная структура.
- [Astrodux: Oxygen Distributor](https://github.com/terrarium-earth/Ad-Astra/blob/5a986665e1d91e31c50321ff225a3fb23558ff35/common/src/main/resources/assets/ad_astra/patchouli_books/astrodux/en_us/entries/the_moon/oxygen_distributor.json) — вода/энергия, обслуживаемое помещение, диагностика утечки. Vireon сохраняет отдельный генератор O₂ и собственные правила аварии.
- [WaterPumpBlockEntity](https://github.com/terrarium-earth/Ad-Astra/blob/5a986665e1d91e31c50321ff225a3fb23558ff35/common/src/main/java/earth/terrarium/adastra/common/blockentities/machines/WaterPumpBlockEntity.java) — игровая возобновляемая вода Minecraft. Этот источник не копируется в Vireon.
- [Steel alloy recipe](https://github.com/terrarium-earth/Ad-Astra/blob/5a986665e1d91e31c50321ff225a3fb23558ff35/common/src/main/generated/resources/data/ad_astra/recipes/alloying/steel_ingot_from_alloying_iron_ingot_and_coals.json) — промышленная ступень железо+углерод.
- [Tier 2 rocket](https://github.com/terrarium-earth/Ad-Astra/blob/5a986665e1d91e31c50321ff225a3fb23558ff35/common/src/main/generated/resources/data/ad_astra/recipes/nasa_workbench/tier_2_rocket_from_nasa_workbench.json) — новый металл ведёт к следующему транспортному уровню. Vireon дополнительно потребляет предыдущую ракету по ранее принятому правилу.
- [Solar panel](https://github.com/terrarium-earth/Ad-Astra/blob/5a986665e1d91e31c50321ff225a3fb23558ff35/common/src/main/generated/resources/data/ad_astra/recipes/solar_panel.json) — Desh в рецепте этой версии. Vireon сознательно имеет панели из стартовых материалов, потому что это прямое решение пользователя.

The Planet Crafter, Astroneer, Oxygen Not Included и Satisfactory остаются жанровыми ориентирами читаемого преобразования среды/экспедиций/систем базы. Их точные рецепты, симуляционные алгоритмы или производительность не объявляются использованными без отдельной проверки. Глобальное терраформирование не приписывается Ad Astra.

## Технические первичные источники

- **T1. [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html).** Повторная геометрия, draw calls, обновление bounds и dispose. Инстансинг выбран для повторяющихся объектов, не как обещание FPS.
- **T2. [MDN IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API).** Асинхронные структурированные данные и транзакции.
- **T3. [MDN Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).** Квоты/удаление отличаются между браузерами; persistence не заменяет экспорт.
- **T4. [W3C Indexed Database API 3.0](https://www.w3.org/TR/IndexedDB/).** Область транзакции, commit, durability. Страничные ревизии и staging — архитектурный выбор Vireon.
- **T5. [MDN visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event).** Скрытие страницы — точка остановки; дополнительно нужны регулярные сохранения, потому что продолжение процесса не гарантируется.
- **T6. [MDN StorageManager.persist](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).** Запрос persistent storage.

Greedy meshing, очереди работ, портовые графы, fixed-step и конкретные размеры чанков — выбранные инженерные решения. Они требуют прототипа и собственных измерений; указанные бюджеты не являются результатом этих источников.
