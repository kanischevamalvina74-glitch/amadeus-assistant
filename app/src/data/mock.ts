export type ToolRun = {
  name: string;
  detail: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  time: string;
  text: string;
  tools?: ToolRun[];
  code?: { file: string; lines: string[] };
  streaming?: boolean;
  error?: boolean;
  errorKind?: "model-missing";
};

export type Conversation = {
  id: string;
  title: string;
  time: string;
  snippet: string;
  group: "Сегодня" | "Вчера";
  active?: boolean;
};

export const conversations: Conversation[] = [
  {
    id: "c1",
    title: "Кофе — и за работу?",
    time: "17:41",
    snippet: "Собрал утренний бриф: 3 задачи, погода, пробки…",
    group: "Сегодня",
    active: true,
  },
  {
    id: "c2",
    title: "Собери отчёт по проекту",
    time: "16:12",
    snippet: "Прочитал 14 файлов в ~/projects/core, сделал сводку…",
    group: "Сегодня",
  },
  {
    id: "c3",
    title: "Что на экране?",
    time: "15:03",
    snippet: "Вижу терминал и ошибку сборки на строке 42…",
    group: "Сегодня",
  },
  {
    id: "c4",
    title: "Напомни про созвон",
    time: "19:20",
    snippet: "Напоминание на 10:00, повтор по будням.",
    group: "Вчера",
  },
  {
    id: "c5",
    title: "Голос Piper: подбор тембра",
    time: "18:44",
    snippet: "Сравнил голоса Ирина и Дмитрий…",
    group: "Вчера",
  },
  {
    id: "c6",
    title: "Плагин погоды",
    time: "12:31",
    snippet: "Подключил, проверил ключ, включил уведомления.",
    group: "Вчера",
  },
];

export const initialMessages: ChatMessage[] = [
  {
    id: "m1",
    role: "user",
    time: "17:41",
    text: "Кофе — и за работу? Собери, что у меня сегодня.",
  },
  {
    id: "m2",
    role: "assistant",
    time: "17:41",
    text:
      "Доброе утро. Сегодня три задачи со сроком: созвон в 10:00, проверка макетов до 14:00 и отчёт по проекту. Начнём с отчёта — он самый долгий.",
    tools: [
      { name: "Календарь", detail: "3 события · 42 мс" },
      { name: "Погода", detail: "Москва · +4°, облачно" },
    ],
  },
  {
    id: "m3",
    role: "assistant",
    time: "17:42",
    text: "По папке проекта: 14 изменённых файлов, 3 новых модуля и одна незавершённая задача.",
    tools: [{ name: "Проверка проекта", detail: "только чтение · 118 мс" }],
    code: {
      file: "core/voice.py",
      lines: [
        "# ЗАДАЧА: вынести детектор активности речи в отдельный процесс",
        "tests/test_pipeline.py: новый",
      ],
    },
  },
];

export function nowTime(): string {
  return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
