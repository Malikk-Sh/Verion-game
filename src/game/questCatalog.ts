/** Approved S2 milestones. Recipe quantities stay in the runtime catalog. */
export const QUEST_IDS = ["materials","bench","tool","kiln","metals","glass","wrench","circuit","generator","electrolyzer","dome","bench2","power","distributor","auto","oxygen","refill","air","base"] as const;
export type QuestId = typeof QUEST_IDS[number];
export type QuestDefinition = { id: QuestId; label: string; item: string; x: number; y: number; parents: QuestId[]; context: QuestId[]; objective: string; recipes: string[] };
export const QUESTS: readonly QuestDefinition[] = [
 {
  "id": "materials",
  "label": "Камень и\nволокно",
  "item": "fiber",
  "x": 60,
  "y": 300,
  "parents": [],
  "context": [],
  "objective": "Собрать камень и разобрать траву на волокно. Пульпа остаётся для еды.",
  "recipes": [
   "grass_parts"
  ]
 },
 {
  "id": "bench",
  "label": "Верстак I",
  "item": "workbench",
  "x": 180,
  "y": 100,
  "parents": [
   "materials"
  ],
  "context": [],
  "objective": "Создать и установить верстак. Четыре типа входов, одна ручная работа; сборка идёт рядом с игроком, в пределах 3,2 м. Очереди нет.",
  "recipes": [
   "craft_workbench"
  ]
 },
 {
  "id": "tool",
  "label": "Запасной\nмультитул",
  "item": "tool_stone",
  "x": 180,
  "y": 210,
  "parents": [
   "materials"
  ],
  "context": [],
  "objective": "Стартовый мультитул уже есть в рюкзаке. Изготовить запасной до поломки первого: инструмент нужен для добычи камня, руд, песка и льда. Это необязательная ветка снабжения.",
  "recipes": [
   "craft_tool_stone"
  ]
 },
 {
  "id": "kiln",
  "label": "Печь",
  "item": "kiln",
  "x": 180,
  "y": 440,
  "parents": [
   "materials"
  ],
  "context": [],
  "objective": "Создать и установить печь. Печь и верстак создаются независимо в кармане.",
  "recipes": [
   "craft_kiln"
  ]
 },
 {
  "id": "metals",
  "label": "Железо\nи медь",
  "item": "iron",
  "x": 300,
  "y": 300,
  "parents": [
   "kiln"
  ],
  "context": [],
  "objective": "Добыть железную и медную руду, выплавить оба слитка. На каждую плавку нужно волокно.",
  "recipes": [
   "smelt_iron_raw",
   "smelt_copper_raw"
  ]
 },
 {
  "id": "glass",
  "label": "Стекло",
  "item": "glass",
  "x": 300,
  "y": 540,
  "parents": [
   "kiln"
  ],
  "context": [],
  "objective": "Добыть песок и выплавить стекло. Верстак и слитки для этого не нужны.",
  "recipes": [
   "glass"
  ]
 },
 {
  "id": "wrench",
  "label": "Гаечный\nключ",
  "item": "wrench",
  "x": 430,
  "y": 90,
  "parents": [
   "metals"
  ],
  "context": [
   "bench"
  ],
  "objective": "Создать многоразовый гаечный ключ для улучшения верстака. Ключ при улучшении сохраняется.",
  "recipes": [
   "craft_wrench"
  ]
 },
 {
  "id": "circuit",
  "label": "Электроника",
  "item": "circuit",
  "x": 430,
  "y": 200,
  "parents": [
   "metals",
   "glass"
  ],
  "context": [
   "bench"
  ],
  "objective": "Изготовить электронный компонент из железа, меди и стекла.",
  "recipes": [
   "craft_circuit"
  ]
 },
 {
  "id": "generator",
  "label": "Биогенератор",
  "item": "biogenerator",
  "x": 430,
  "y": 310,
  "parents": [
   "metals"
  ],
  "context": [
   "bench"
  ],
  "objective": "Создать и установить биогенератор снаружи купола. Одно волокно даёт 200 EU, выдача — до 40 EU/с. Запас топлива конечен.",
  "recipes": [
   "craft_biogenerator"
  ]
 },
 {
  "id": "electrolyzer",
  "label": "Электролизёр",
  "item": "electrolyzer",
  "x": 430,
  "y": 440,
  "parents": [
   "metals",
   "glass"
  ],
  "context": [
   "bench"
  ],
  "objective": "Создать и установить электролизёр. Станция растапливает лёд в воду и затем производит кислород; обе операции требуют питания.",
  "recipes": [
   "craft_electrolyzer"
  ]
 },
 {
  "id": "dome",
  "label": "Купол",
  "item": "dome",
  "x": 430,
  "y": 550,
  "parents": [
   "metals",
   "glass"
  ],
  "context": [
   "bench"
  ],
  "objective": "Создать и установить герметичный купол. Пустой купол ещё не даёт пригодный для дыхания воздух. Ручной шлюз — часть работающей системы купола.",
  "recipes": [
   "craft_dome"
  ]
 },
 {
  "id": "bench2",
  "label": "Верстак II",
  "item": "workbench_2",
  "x": 570,
  "y": 135,
  "parents": [
   "wrench",
   "circuit"
  ],
  "context": [],
  "objective": "Выбрать ключ в быстром доступе, подойти к свободному верстаку I и улучшить его. Открывается очередь до пяти партий вместе с активной; для работы нужно питание.",
  "recipes": [
   "upgrade"
  ]
 },
 {
  "id": "power",
  "label": "Энергосеть",
  "item": "cable",
  "x": 570,
  "y": 310,
  "parents": [
   "generator"
  ],
  "context": [],
  "objective": "Изготовить провод и кабель, заправить генератор волокном и подключить станцию. Засчитывается передача энергии через оплаченный кабель, а не просто постройка генератора. Один сегмент — не длиннее 4 м.",
  "recipes": [
   "craft_wire",
   "craft_cable"
  ]
 },
 {
  "id": "distributor",
  "label": "Распределитель",
  "item": "distributor",
  "x": 570,
  "y": 550,
  "parents": [
   "circuit"
  ],
  "context": [],
  "objective": "Создать и установить распределитель. Для работы климата он должен находиться внутри купола и получать питание и O₂. Купол можно построить в другом порядке.",
  "recipes": [
   "craft_distributor"
  ]
 },
 {
  "id": "auto",
  "label": "Автосборка",
  "item": "workbench_2",
  "x": 710,
  "y": 135,
  "parents": [
   "bench2",
   "power"
  ],
  "context": [],
  "objective": "Завершить хотя бы одну партию на верстаке II, отойдя от него. Во время работы расходуется 4 EU/с; без питания работа останавливается. Производство идёт только в активном игровом времени.",
  "recipes": []
 },
 {
  "id": "oxygen",
  "label": "Свой O₂",
  "item": "oxygen",
  "x": 710,
  "y": 440,
  "parents": [
   "electrolyzer",
   "power"
  ],
  "context": [],
  "objective": "Добыть лёд, растопить его в электролизёре и произвести собственный кислород. Вода: 2 с при 6 EU/с; электролиз: 10 с при 12 EU/с, выход 240 GU O₂. H₂ пока сбрасывается.",
  "recipes": [
   "melt_in_generator",
   "electrolysis"
  ]
 },
 {
  "id": "refill",
  "label": "Заправленный\nбаллон",
  "item": "bottle_1",
  "x": 850,
  "y": 395,
  "parents": [
   "oxygen"
  ],
  "context": [],
  "objective": "Создать баллон и заправочную станцию, подать питание и O₂ трубой. Засчитывается реальный перенос газа в установленный баллон. Новый баллон создаётся пустым; эта ветка не обязательна для купола.",
  "recipes": [
   "craft_refill",
   "craft_bottle_1",
   "craft_gas_pipe"
  ]
 },
 {
  "id": "air",
  "label": "Дышащее\nубежище",
  "item": "dome",
  "x": 850,
  "y": 550,
  "parents": [
   "dome",
   "distributor",
   "oxygen"
  ],
  "context": [],
  "objective": "Подключить O₂-трубу к распределителю внутри запитанного купола. Цель выполнена, когда оболочка герметична, O₂ не меньше 384 GU, чистота не ниже 50%, температура от −5 до 40 °C. Нужны все три ветви. Верстак II для этого не требуется.",
  "recipes": [
   "craft_gas_pipe"
  ]
 },
 {
  "id": "base",
  "label": "База\nработает",
  "item": "dome",
  "x": 966,
  "y": 265,
  "parents": [
   "auto",
   "air"
  ],
  "context": [],
  "objective": "Запустить автосборку, пока в куполе пригодный для дыхания воздух. Завершите хотя бы одну партию вдали от верстака, затем обеспечьте одновременную работу обеих систем.",
  "recipes": []
 }
];
export const QUEST_BY_ID = new Map(QUESTS.map(q => [q.id,q]));
export const QUEST_ROUTES: readonly {from:string;to:string;d:string;arrow:boolean;context:boolean}[] = [{"from":"materials","to":"bench","d":"M 87 300 L 105 300 Q 114 300 114 291 L 114 109 Q 114 100 123 100 L 152 100","arrow":true,"context":false},{"from":"materials","to":"tool","d":"M 87 300 L 105 300 Q 114 300 114 291 L 114 219 Q 114 210 123 210 L 152 210","arrow":true,"context":false},{"from":"materials","to":"kiln","d":"M 87 300 L 105 300 Q 114 300 114 309 L 114 431 Q 114 440 123 440 L 152 440","arrow":true,"context":false},{"from":"kiln","to":"metals","d":"M 207 440 L 233 440 Q 242 440 242 431 L 242 309 Q 242 300 251 300 L 272 300","arrow":true,"context":false},{"from":"kiln","to":"glass","d":"M 207 440 L 233 440 Q 242 440 242 449 L 242 531 Q 242 540 251 540 L 272 540","arrow":true,"context":false},{"from":"bench","to":"assembly","d":"M 207 100 L 249 100 Q 258 100 258 91 L 258 62 Q 258 53 267 53 L 387 53","arrow":false,"context":true},{"from":"metals","to":"wrench","d":"M 327 300 L 345 300 Q 354 300 354 291 L 354 99 Q 354 90 363 90 L 402 90","arrow":true,"context":false},{"from":"metals","to":"circuit","d":"M 327 300 L 345 300 Q 354 300 354 291 L 354 209 Q 354 200 363 200 L 390 200","arrow":false,"context":false},{"from":"metals","to":"generator","d":"M327 300 L345 300 Q354 300 354 305 L354 305 Q354 310 359 310 L370 310 M378 310 L402 310","arrow":true,"context":false},{"from":"metals","to":"electrolyzer","d":"M 327 300 L 345 300 Q 354 300 354 309 L 354 431 Q 354 440 363 440 L 390 440","arrow":false,"context":false},{"from":"metals","to":"dome","d":"M 327 300 L 345 300 Q 354 300 354 309 L 354 541 Q 354 550 363 550 L 390 550","arrow":false,"context":false},{"from":"glass","to":"circuit","d":"M 327 540 L 365 540 Q 374 540 374 531 L 374 209 Q 374 200 383 200 L 390 200","arrow":false,"context":false},{"from":"join","to":"circuit","d":"M 398 200 L 402 200","arrow":true,"context":false},{"from":"glass","to":"electrolyzer","d":"M 327 540 L 365 540 Q 374 540 374 531 L 374 449 Q 374 440 383 440 L 390 440","arrow":false,"context":false},{"from":"join","to":"electrolyzer","d":"M 398 440 L 402 440","arrow":true,"context":false},{"from":"glass","to":"dome","d":"M 327 540 L 365 540 Q 374 540 374 549 L 374 541 Q 374 550 383 550 L 390 550","arrow":false,"context":false},{"from":"join","to":"dome","d":"M 398 550 L 402 550","arrow":true,"context":false},{"from":"wrench","to":"bench2","d":"M 457 90 L 481 90 Q 490 90 490 99 L 490 126 Q 490 135 499 135 L 526 135","arrow":false,"context":false},{"from":"circuit","to":"bench2","d":"M 457 200 L 481 200 Q 490 200 490 191 L 490 144 Q 490 135 499 135 L 526 135","arrow":false,"context":false},{"from":"join","to":"bench2","d":"M 534 135 L 542 135","arrow":true,"context":false},{"from":"circuit","to":"distributor","d":"M 457 200 L 501 200 Q 510 200 510 209 L 510 541 Q 510 550 519 550 L 542 550","arrow":true,"context":false},{"from":"generator","to":"power","d":"M457 310 L506 310 M514 310 L542 310","arrow":true,"context":false},{"from":"bench2","to":"auto","d":"M 597 135 L 666 135","arrow":false,"context":false},{"from":"power","to":"auto","d":"M 597 310 L 629 310 Q 638 310 638 301 L 638 144 Q 638 135 647 135 L 666 135","arrow":false,"context":false},{"from":"join","to":"auto","d":"M 674 135 L 682 135","arrow":true,"context":false},{"from":"electrolyzer","to":"oxygen","d":"M457 440 L506 440 M514 440 L666 440","arrow":false,"context":false},{"from":"power","to":"oxygen","d":"M 597 310 L 629 310 Q 638 310 638 319 L 638 431 Q 638 440 647 440 L 666 440","arrow":false,"context":false},{"from":"join","to":"oxygen","d":"M 674 440 L 682 440","arrow":true,"context":false},{"from":"oxygen","to":"refill","d":"M 737 440 L 771 440 Q 780 440 780 431 L 780 404 Q 780 395 789 395 L 822 395","arrow":true,"context":false},{"from":"oxygen","to":"air","d":"M 737 440 L 771 440 Q 780 440 780 449 L 780 541 Q 780 550 789 550 L 794 550","arrow":false,"context":false},{"from":"distributor","to":"air","d":"M 597 550 L 794 550","arrow":false,"context":false},{"from":"dome","to":"air","d":"M 457 550 L 469 550 Q 478 550 478 559 L 478 603 Q 478 612 487 612 L 785 612 Q 794 612 794 603 L 794 550","arrow":false,"context":false},{"from":"join","to":"air","d":"M 802 550 L 822 550","arrow":true,"context":false},{"from":"auto","to":"base","d":"M 737 135 L 897 135 Q 906 135 906 144 L 906 256 Q 906 265 915 265 L 924 265","arrow":false,"context":false},{"from":"air","to":"base","d":"M 877 550 L 897 550 Q 906 550 906 541 L 906 274 Q 906 265 915 265 L 924 265","arrow":false,"context":false},{"from":"join","to":"base","d":"M 932 265 L 938 265","arrow":true,"context":false}];
export const QUEST_HUBS: readonly {id:QuestId;x:number;y:number}[] = [{"id":"circuit","x":390,"y":200},{"id":"electrolyzer","x":390,"y":440},{"id":"dome","x":390,"y":550},{"id":"bench2","x":526,"y":135},{"id":"auto","x":666,"y":135},{"id":"oxygen","x":666,"y":440},{"id":"air","x":794,"y":550},{"id":"base","x":924,"y":265}];
export const QUEST_MAP = {width:1018,height:638};
