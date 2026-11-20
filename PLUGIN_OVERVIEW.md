Talk to a thread's agent hands-free, the way ChatGPT and Codex voice work.

## What you get

- **A waveform where send is** when the composer is empty and the agent is idle. Click it to start a voice chat. Type to bring the send arrow back. Or press **Ctrl+Shift+V** any time, like Codex. Rebind it in Settings → Keyboard.
- **Full duplex with barge-in.** Talk over the voice and it stops at once. The voice model knows how much you heard.
- **The agent does the work.** The voice model forwards requests to the thread's agent and answers "is it done?". It stops the agent when you say stop and reports the result when the turn ends. It also tells you when the agent waits on you in bb.
- **A live pill** in place of the mic shows status, mute, end, and a waveform that follows your voice and the reply. If you navigate away, it continues in a sidebar pill (with the thread's name, or a compact one-liner) and links back to the thread.

## Setup

Install a plugin that provides realtime connections (for example, a company AI proxy plugin) and leave **Connection** on auto. That plugin picks the model. Or add an OpenAI API key, which talks to OpenAI directly, and pick the model in Voice Mode's settings. You always pick the voice here.

Voice Mode supports `gpt-realtime-*` and GPT-Live (`gpt-live-*`) models. GPT-Live hands tool calls to an OpenAI Responses model. Leave **Delegation backend model** on Auto, or pick one in the settings.

## Notes

- While a session is on, the realtime provider gets your mic audio, the thread title, and the agent's messages. It receives the latest message at start, then the first 2,500 characters of each reply. Sessions end after 5 idle minutes (20 while the agent works) and after 30 minutes regardless.
- By default, your words reach the agent as transcribed. Set **What gets sent to the agent** to rewritten to have the voice model write the request instead. Either way, it forwards at most one message per thing you say. Voice Mode treats agent replies as data, so the voice model cannot act on them. An option marks spoken messages with `[Voice Mode]`. It is off by default.
- bb has no plugin slot for the send button or mic, so the plugin relies on bb's composer markup. If a bb update changes that markup, the waveform falls back to sitting beside bb's buttons instead of replacing send. A bb update never affects bb's own send and dictation.
