import { useEffect, useState } from "react";
import { prefs } from "./api";

export type Locale = "ru" | "en";

type Messages = Record<string, { ru: string; en: string }>;

/** Базовый словарь интерфейса: рабочий экран, свёрнутый режим, настройки. */
const MESSAGES: Messages = {
  "status.online": { ru: "Ядро в сети", en: "Core online" },
  "status.offline": { ru: "Ядро не в сети", en: "Core offline" },
  "status.noModel": { ru: "Модель не загружена", en: "Model not loaded" },
  "status.storage": { ru: "SQLite · локальное хранилище", en: "SQLite · local storage" },
  "status.demo": { ru: "демо-режим без ядра", en: "demo mode without core" },
  "status.russian": { ru: "русский", en: "Russian" },
  "status.cpu": { ru: "Процессор", en: "CPU" },
  "status.memory": { ru: "память", en: "Memory" },
  "status.temp": { ru: "темп.", en: "Temp." },
  "theme.toggle": { ru: "Светлая", en: "Light" },
  "theme.toggleDark": { ru: "Тёмная", en: "Dark" },
  "nav.history": { ru: "История", en: "History" },
  "nav.project": { ru: "Проект", en: "Project" },
  "nav.terminal": { ru: "Терминал", en: "Terminal" },
  "nav.workshop": { ru: "Мастерская", en: "Workshop" },
  "nav.center": { ru: "Центр управления", en: "Control center" },
  "nav.settings": { ru: "Настройки", en: "Settings" },
  "sidebar.search": { ru: "Поиск по диалогам", en: "Search conversations" },
  "state.idle": { ru: "готов — скажите «Amadeus»", en: "ready — say “Amadeus”" },
  "state.listening": { ru: "слушаю — говорите команду", en: "listening — say a command" },
  "state.thinking": { ru: "думаю", en: "thinking" },
  "state.speaking": { ru: "говорю", en: "speaking" },
  "state.error": { ru: "ошибка", en: "error" },
  "state.muted": { ru: "микрофон выключен", en: "microphone muted" },
  "voice.microphone": { ru: "Микрофон", en: "Microphone" },
  "voice.collapse": { ru: "Esc", en: "Esc" },
  "composer.placeholder": { ru: "Спросите что-нибудь или скажите «Amadeus»", en: "Ask something or say “Amadeus”" },
  "composer.hintEnter": { ru: "Enter — отправить", en: "Enter — send" },
  "composer.hintCommands": { ru: "Ctrl+K — команды", en: "Ctrl+K — commands" },
  "composer.hintMic": { ru: "F4 — микрофон", en: "F4 — microphone" },
  "composer.local": { ru: "локально · без облака", en: "local · no cloud" },
  "panel.telemetry": { ru: "Телеметрия", en: "Telemetry" },
  "panel.tools": { ru: "Инструменты", en: "Tools" },
  "panel.activity": { ru: "Активность", en: "Activity" },
  "mini.ready": { ru: "Готов — скажите «Amadeus»", en: "Ready — say “Amadeus”" },
  "mini.listening": { ru: "Слушаю — говорите команду", en: "Listening — say a command" },
  "mini.ptt": { ru: "Говорите — отпустите пробел", en: "Speak — release Space" },
  "mini.wake": { ru: "Скажите «Amadeus» — отвечу без кликов", en: "Say “Amadeus” — no clicks needed" },
  "settings.title": { ru: "Настройки", en: "Settings" },
  "settings.general": { ru: "Общие", en: "General" },
  "settings.locale": { ru: "Язык интерфейса", en: "Interface language" },
  "settings.theme": { ru: "Тема", en: "Theme" },
  "settings.accent": { ru: "Акцент", en: "Accent" },
  "accent.cyan": { ru: "Циан", en: "Cyan" },
  "accent.brass": { ru: "Латунь", en: "Brass" },
  "accent.amber": { ru: "Латунь", en: "Brass" },
  "accent.violet": { ru: "Латунь", en: "Brass" },
  "accent.green": { ru: "Зелёный", en: "Green" },
  "settings.providers": { ru: "Провайдеры и модели", en: "Providers and models" },
  "settings.voice": { ru: "Голос и аудио", en: "Voice and audio" },
  "settings.security": { ru: "Безопасность", en: "Security" },
  "settings.data": { ru: "Экспорт и импорт", en: "Export and import" },
  "setup.title": { ru: "Как запустить голос", en: "How to start the voice" },
  "setup.step1": { ru: "1. Подключите Ollama", en: "1. Connect Ollama" },
  "setup.step1desc": { ru: "Это локальная программа с моделями. Она должна быть запущена на этом компьютере.", en: "This is a local program with models. It must be running on this computer." },
  "setup.address": { ru: "Адрес Ollama", en: "Ollama address" },
  "setup.check": { ru: "Проверить подключение", en: "Check connection" },
  "setup.notChecked": { ru: "Нажмите «Проверить подключение», чтобы увидеть результат.", en: "Click “Check connection” to see the result." },
  "setup.connected": { ru: "Подключено. Доступно моделей: {n}.", en: "Connected. Models available: {n}." },
  "setup.notConnected": { ru: "Не подключено: {error}. Запустите Ollama и нажмите «Проверить подключение».", en: "Not connected: {error}. Start Ollama and click “Check connection”." },
  "setup.step2": { ru: "2. Выберите модель и подключите её", en: "2. Choose a model and connect it" },
  "setup.step2desc": { ru: "Без выбранной модели ассистент не сможет отвечать.", en: "Without a selected model the assistant cannot answer." },
  "setup.model": { ru: "Модель", en: "Model" },
  "setup.noModels": { ru: "Нет доступных моделей", en: "No models available" },
  "setup.connectModel": { ru: "Подключить модель", en: "Connect model" },
  "setup.step3": { ru: "3. Выберите голос и проверьте микрофон", en: "3. Choose a voice and test the microphone" },
  "setup.step3desc": { ru: "Раздел «Голос» ниже. Нажмите «Проверить микрофон», чтобы убедиться, что ассистент вас слышит.", en: "See “Voice” below. Click “Test microphone” to make sure the assistant can hear you." },
  "notify.ollamaError": { ru: "Ollama не отвечает: {error}", en: "Ollama is not responding: {error}" },
  "notify.ollamaOk": { ru: "Ollama подключена. Моделей: {n}", en: "Ollama connected. Models: {n}" },
  "notify.selectModelFirst": { ru: "Сначала выберите модель из списка", en: "Choose a model from the list first" },
  "notify.modelConnected": { ru: "Подключена модель: {model}", en: "Model connected: {model}" },
  "notify.micOk": { ru: "Микрофон работает", en: "Microphone works" },
  "notify.micDenied": { ru: "Микрофон недоступен. Разрешите доступ в системе", en: "Microphone unavailable. Allow access in the system settings" },
};

export function t(locale: Locale, key: string): string {
  const item = MESSAGES[key];
  return item ? item[locale] : key;
}

/** Язык живёт в профиле на ядре; смена в настройках рассылается событием. */
export function useLocale() {
  const [locale, setLocale] = useState<Locale>("ru");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const values = await prefs.get(["app.locale"]);
        if (!cancelled) setLocale(values["app.locale"] === "en" ? "en" : "ru");
      } catch {
        // без ядра остаётся русский
      }
    };
    void load();
    const onLocale = (event: Event) => {
      const detail = (event as CustomEvent<Locale>).detail;
      setLocale(detail === "en" ? "en" : "ru");
    };
    window.addEventListener("amadeus.locale", onLocale);
    return () => {
      cancelled = true;
      window.removeEventListener("amadeus.locale", onLocale);
    };
  }, []);

  return { locale, t: (key: string) => t(locale, key) };
}
