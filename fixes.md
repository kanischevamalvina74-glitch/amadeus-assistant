# fixes: Амадеус — что говорят пользователи и что делать

Выборка: **116 отзывов** из 2 источников — App Store (`Jarvis - Voice AI Assistant`, id 6787468112, официальный RSS) и Hacker News (официальный Algolia API). Ещё один источник (Reddit/Trustpilot) был недоступен: 403, поэтому в выборке их нет. Ни одна цитата не выдумана; каждая — дословная строка из `reviews.csv` со ссылкой. Тонкие темы (<3 отзывов или один источник) помечены.

## 1. Что они ненавидят

| проблема | отзывов | источников | цитата |
| --- | --- | --- | --- |
| Голос обрывается, ассистент не слышит или не озвучивает | 14 | 2 | «When I talk to Jarvis, he keeps cutting in and out. When he talks, I can hear half of what he’s talking about and the rest of the time he’s just silent, but I can read what he’s saying.» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software; «…it doesn’t seem to hear me until I’ve said something three times and then it wants to answer me multiple times.» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software |
| «Свой ключ» ограничен тремя серверами, плюс квоты/кредиты | 11 | 2 | «It claims to allow you to bring your own key, but only if you use one of three servers. If you have another server, this is not for you.» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software; «I can’t even use it always says that I have no credits left. Please fix this.» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software |
| Медленно отвечает | 6 | 2 (тонко: часть совпадений шумные) | «w app a little slow though» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software |
| Нет фонового режима и напоминаний | 3 | 1 (тонко) | «…lo unico que le falta es funcionar en segundo plano…» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software; «Forgot I wanted a reminder to drive rideshare today» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software |
| Мало настроек внешнего вида | 6 | 2 | «The only thing I can think of to add are more cosmetic options in app, would love to increase the Jarvis feel further…» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software |

## 2. Чего не хватает

| запрос | отзывов | источников | цитата |
| --- | --- | --- | --- |
| Любой OpenAI-совместимый провайдер вместо трёх разрешённых | 11 | 2 | «It claims to allow you to bring your own key, but only if you use one of three servers.» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software; «I am eagerly awaiting the OpenAI update to test it out.» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software |
| Надёжный голос: PTT, локальное распознавание, выбор голоса | 14 | 2 | «I seem to have issues with Jarvis hearing me.» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software; «The app is actually great but the problem is I'm not able to hear it at anyway» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software |
| Напоминания и работа в фоне | 3 | 1 (тонко) | «Forgot I wanted a reminder to drive rideshare today» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software |
| Полностью локальный режим без подписки и VPN | 12 | 1 (тонко: только HN) | «My voice projects need to run entirely offline on a variety of hardware and operating systems.» — https://news.ycombinator.com/item?id=24098950; «zero tracking, zero subscription, zero bullshit» — https://news.ycombinator.com/item?id=46103570 |
| Больше косметических опций и голосов | 6 | 2 | «…more cosmetic options in app, would love to increase the Jarvis feel further…» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software |

## 3. Что не решено (это станет позиционированием)

- **Честный BYOK без квот и списка из трёх серверов.** 11 отзывов, 2 источника. Доказательство: «If you have another server, this is not for you.» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software
- **Голос и данные остаются на машине.** 12 отзывов, 1 источник (тонко). Доказательство: «No privacy problems, no extreme costs, just ease of use, low latency, offline, blazingly fast beauty.» — https://news.ycombinator.com/item?id=35825858
- **Ассистент, который слышит с первого раза и не обрывается.** 14 отзывов, 2 источника. Доказательство: «he keeps cutting in and out» — https://itunes.apple.com/us/review?id=6787468112&type=Purple%20Software
- **Никакой подписки ради базовых функций.** 12 отзывов, 1 источник (тонко). Доказательство: «zero tracking, zero subscription, zero bullshit» — https://news.ycombinator.com/item?id=46103570

## План исправлений (сила доказательств × дешевизна)

| приоритет | что построить / изменить | размер | скилл / статус в клоне | доказательства |
| --- | --- | --- | --- | --- |
| 1 | Любой OpenAI-совместимый endpoint + явный список разрешённых хостов вместо трёх фиксированных | S | `replica-backend`, уже сделано: `streams.openai_chat`, `AMADEUS_PROVIDER_ALLOWLIST` | 11 отзывов, 2 источника |
| 2 | Надёжный голосовой каскад: Silero VAD, Whisper, PTT, локальное кодовое слово, выбор голоса | M | `replica-build`, сделано: `AMADEUS_VAD`, `WS /ws/wake`, PTT пробелом, Piper | 14 отзывов, 2 источника |
| 3 | Полностью локальный режим без сети: Ollama + Whisper + Piper, честные пометки про интернет | M | `replica-architect`, сделано | 12 отзывов, 1 источник (тонко) |
| 4 | RU/EN-интерфейс и темы/акценты | S | `replica-build`, RU/EN и тёмная/светлая сделаны; акценты остаются | 6 отзывов, 2 источника |
| 5 | Напоминания с уведомлением ОС и понятный статус «фоновый режим» | S | `replica-backend`, напоминания и уведомления сделаны; фоновый режим мобильного нет | 3 отзыва, 1 источник (тонко) |
| 6 | Каталог плагинов с установкой внутри приложения | M | `replica-build`, частично: список манифестов в UI | gap из matrices, доказательства слабые (тонко) |

## Угол позиционирования

1. **Для тех, кого бесит, что «свой ключ» работает только с тремя серверами и внезапно кончаются кредиты, Амадеус** работает с любым OpenAI-совместимым провайдером и локальными моделями, без подписки и VPN. Доказательства: тема BYOK — 11 отзывов из 2 источников; локальный режим — 12 отзывов из 1 источника (тонко).
2. Для тех, кого бесит, что ассистент не слышит с первого раза, **Амадеус** слушает локально и поддерживает PTT с кодовым словом. Доказательства: 14 отзывов из 2 источников.
3. Для тех, кто не хочет отдавать голос в облако, **Амадеус** держит модель, диалоги и ключи на вашем компьютере. Доказательства: 12 отзывов из 1 источника (тонко).

**Рекомендую №1** — у него самая сильная комбинация доказательств, и клон уже это умеет. Именно этот угол несёт в имя и голос `replica-brand` и в hero `replica-launch`. Имя оригинала в название, рекламу и листинг не ставим.
