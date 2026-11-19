import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSdk, useSettings } from "@get-bb/plugin-sdk/app";
import { LANGUAGES, LIVE_VOICES, REALTIME_VOICES, speechLanguage } from "./live-voices";
import type { VoiceSession } from "./session";

type Trigger = ButtonHTMLAttributes<HTMLButtonElement> & { "data-voice-options-trigger": string };
const hint = "Удерживайте для выбора голоса и языка (Shift+F10)";

export function VoiceOptions({ session, children }: {
  session?: VoiceSession;
  children(trigger: Trigger, open: () => void): ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppress = useRef(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  function cancel() {
    clearTimeout(timer.current);
    pointer.current = null;
  }
  useEffect(() => {
    window.addEventListener("blur", cancel);
    return () => { cancel(); window.removeEventListener("blur", cancel); };
  }, []);
  function open() {
    cancel();
    setVisible(true);
  }
  const trigger: Trigger = {
    "data-voice-options-trigger": "", title: hint, "aria-haspopup": "dialog", "aria-expanded": visible,
    onPointerDown(e) {
      cancel();
      if (!e.isPrimary || e.button !== 0) return;
      anchor.current = e.currentTarget;
      suppress.current = false;
      pointer.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => { suppress.current = true; open(); }, 550);
    },
    onPointerMove(e) {
      const p = pointer.current;
      if (p?.id === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 9) {
        suppress.current = true;
        cancel();
      }
    },
    onPointerUp: cancel, onPointerCancel: cancel, onPointerLeave: cancel,
    onContextMenu(e) {
      e.preventDefault();
      anchor.current = e.currentTarget;
      suppress.current = true;
      open();
    },
    onKeyDown(e) {
      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
        e.preventDefault();
        anchor.current = e.currentTarget;
        open();
      }
    },
    onClickCapture(e) {
      if (suppress.current && e.detail !== 0) {
        e.preventDefault();
        e.stopPropagation();
      }
      suppress.current = false;
    },
  };
  return <>{children(trigger, open)}{visible && createPortal(
    <OptionsDialog session={session} dismiss={() => { setVisible(false); anchor.current?.focus(); }} />,
    document.body,
  )}</>;
}

function OptionsDialog({ session, dismiss }: { session?: VoiceSession; dismiss(): void }) {
  const { values } = useSettings();
  const sdk = useSdk();
  const dialog = useRef<HTMLDialogElement>(null);
  const [voice, setVoice] = useState<string>();
  const [language, setLanguage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  const codex = values?.connection === "codex-live-first";
  const key = codex ? "codexLiveVoice" : "voice";
  const currentVoice = String(values?.[key] ?? (codex ? "cove" : "marin"));
  const currentLanguage = speechLanguage(values?.speechLanguage);
  async function save() {
    if (saving || !values) return;
    const changes: Record<string, string> = {};
    if (voice && voice !== currentVoice) changes[key] = voice;
    if (language && language !== currentLanguage) changes.speechLanguage = language;
    if (!Object.keys(changes).length) return dismiss();
    const restart = session?.changeVoiceOnSave();
    setSaving(true);
    setError("");
    try {
      await sdk.plugins.updateSettings({ pluginId: "voice-mode", values: changes });
      dismiss();
      await restart?.();
    } catch {
      setSaving(false);
      setError("Не удалось применить настройки.");
    }
  }
  return <dialog ref={dialog} className="voice-options" aria-label="Голос и язык"
    onCancel={e => { e.preventDefault(); if (!saving) dismiss(); }}
    onPointerDown={e => { if (!saving && e.target === dialog.current) {
      const r = dialog.current.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dismiss();
    } }}>
    <form onSubmit={e => { e.preventDefault(); e.stopPropagation(); void save(); }}>
      <h2>Голос и язык</h2>
      <label>Голос<select disabled={!values || saving} value={voice ?? currentVoice} onChange={e => setVoice(e.target.value)}>
        {(codex ? LIVE_VOICES : REALTIME_VOICES).map(v => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
      </select></label>
      <label>Язык речи<select disabled={!values || saving} value={language ?? currentLanguage} onChange={e => setLanguage(e.target.value)}>
        {Object.entries(LANGUAGES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      {error && <span role="alert">{error}</span>}
      <footer><button type="button" disabled={saving} onClick={dismiss}>Отмена</button>
        <button type="submit" disabled={saving || !values}>{session && ["listening", "speaking", "connecting"].includes(session.state.phase) ? "Применить и перезвонить" : "Применить"}</button></footer>
    </form>
  </dialog>;
}
