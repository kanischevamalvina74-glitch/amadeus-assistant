# Подпись сборки через SignPath

Бесплатная подпись для open-source проектов. Приватный ключ хранится у SignPath — в репозитории лежит только API-токен.

## Что уже готово

- `.github/workflows/ci.yml`: задача `signing` собирает Tauri, загружает `Amadeus.exe` как артефакт, отправляет запрос на подпись через `signpath/github-action-submit-signing-request@v3`, проверяет результат `signtool verify /pa` и публикует подписанный артефакт.
- `replica/LICENSE`: MIT — условие бесплатной OSS-подписи.
- `replica/app/scripts/sign-windows.ps1`: локальная подпись самоподписанным сертификатом **только для отладки** (антивирусы всё равно могут ругаться).

## Настройка аккаунта

1. Репозиторий должен быть **публичным** и с OSS-лицензией (`replica/LICENSE` уже есть).
2. Зарегистрируйтесь в <https://app.signpath.io> и создайте организацию.
3. В разделе Trusted Build Systems добавьте **GitHub.com** и привяжите его к проекту.
4. В SignPath: `Projects → New Project`, slug например `amadeus`.
5. Artifact Configuration: корневой элемент `<zip-file>` (подходит для артефакта `actions/upload-artifact`) или отдельная конфигурация для `.exe`.
6. Signing Policy: выберите политику **Open Source Code Signing** и укажите репозиторий `владелец/репозиторий`.
7. Создайте API-токен пользователя с правом *submitter* для этого проекта и политики.

## Секреты и переменные GitHub

`Settings → Secrets and variables → Actions`:

| тип | имя | значение |
| --- | --- | --- |
| Secret | `SIGNPATH_API_TOKEN` | токен из SignPath |
| Variable | `SIGNPATH_ORGANIZATION_ID` | ID организации в SignPath |
| Variable | `SIGNPATH_PROJECT_SLUG` | `amadeus` |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | slug политики OSS |

Если репозиторий приватный или не установлено GitHub App `signpath`, workflow уже содержит необходимые права `actions: read` и `contents: read`.

## Проверка

После запуска `CI` задача `Подпись через SignPath (open source)` должна завершиться зелёной, а артефакт `amadeus-signed` — содержать подписанный `Amadeus.exe`. Локально:

```powershell
signtool verify /pa /v Amadeus.exe
```

Затем загрузите exe в VirusTotal и убедитесь, что репутация издателя не пустая. Подпись нужно ставить до публикации установщика — репутация копится с первого подписанного релиза.
