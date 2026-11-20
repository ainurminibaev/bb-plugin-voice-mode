[English](README.md) · **Русский**

# Voice Mode — личная редакция

Форк [Voice Mode Стива Фроста](https://github.com/steveafrost/bb-plugin-voice-mode)
под той же лицензией MIT и с тем же ID плагина. Голосовой разговор с агентом
треда BB без рук: когда поле ввода пустое и агент свободен, кнопка отправки
становится волной — нажмите, и начнётся полнодуплексный голосовой чат. Голосовая
модель передаёт настоящую работу агенту треда, сообщает, когда он закончил, и
замолкает, как только вы начинаете говорить.

Что добавлено в ветке `main`:

- русские разговорные инструкции, речь от первого лица;
- компактная кнопка запуска голоса на экране нового треда;
- приветствие, когда микрофон готов;
- настройки шумоподавления и распознавания речи (`vadThreshold` 0.7,
  `silenceDurationMs` 900, `noiseReduction` `far_field`/`near_field`), русская
  транскрипция;
- честный статус незавершённой работы;
- мост Codex Live 1.1 через вход Codex и последовательность подключения с
  отдельным голосом для каждой ступени.

Общие исправления предлагаются в исходный проект отдельными
[pull request](https://github.com/steveafrost/bb-plugin-voice-mode/pulls?q=is%3Apr+author%3Aainurminibaev).
Описание каждой версии — на [странице релизов](https://github.com/ainurminibaev/bb-plugin-voice-mode/releases).

## Установка

```sh
bb plugin install git:https://github.com/ainurminibaev/bb-plugin-voice-mode.git@^0.2.0 --yes
```

Обновление — экран обновлений плагинов BB или `bb plugin update voice-mode`. Не
ставьте форк рядом с оригиналом под другим ID. Нужен плагин ChatGPT Realtime
Connection и личный вход Codex через ChatGPT на машине сервера BB: голос
расходует вашу подписку. Плагин входит в набор
[bb-config](https://github.com/ainurminibaev/bb-config), который ставит его вместе
с зависимостями.

Проверка: `npm ci --include=dev`, `npm test`, `npm run typecheck`,
`bb plugin build .`. Полная документация, в том числе исходного проекта, — в
[README.md](README.md) (на английском).
