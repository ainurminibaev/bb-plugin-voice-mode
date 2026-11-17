/**
 * Where the voice button goes in bb's compact composer.
 *
 * bb draws a compact composer (collapsed, or phone width with a coarse
 * pointer) without a plugin action slot, so the app overlay has to host the
 * button and portal it in. Forms carry no thread id, so a host is paired to a
 * form by position, which only holds while the two lists line up.
 */

/** What a compact host needs to know about one of bb's composers. */
import type { ComposerSelection } from "@get-bb/plugin-sdk/app";

/** A visible user-clicked voice start creates a normal thread, never a hidden worker. */
export function newVoiceThreadRequest(projectId: string, selection: ComposerSelection) {
  if (!projectId.trim()) throw new Error("Сначала выбери проект.");
  return {
    ...selection,
    projectId,
    environment: selection.environment ?? { type: "project-default" as const },
    title: "Голосовой разговор",
    prompt: "[Voice Mode] Пользователь включил голосовой режим нового разговора. Пока задачи по проекту нет: не запускай команды и не меняй файлы. Коротко подтверди готовность и жди голосового запроса.",
  };
}

/** Place the compact new-thread action beside the host mic, with cleanup. */
export function mountNewVoiceButton(anchor: HTMLElement, onHost: (host: HTMLElement | null) => void): () => void {
  const shell = anchor.closest("[data-app-composer]") ?? anchor.closest("form");
  if (!shell) return () => {};
  const portal = document.createElement("span");
  portal.className = "voice-mode-host";
  portal.setAttribute("data-bb-plugin-root", "");
  portal.setAttribute("data-bb-plugin", "voice-mode");
  let frame = 0;
  let current: HTMLElement | null = null;
  const place = () => {
    frame = 0;
    const form = anchor.closest("form") ?? shell.querySelector("form[data-promptbox]");
    const group = form?.querySelector("[data-promptbox-submit-group]");
    if (group && portal.nextSibling !== group) group.before(portal);
    if (!group) portal.remove();
    const next = portal.isConnected ? portal : null;
    if (next !== current) { current = next; onHost(next); }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
  const observer = new MutationObserver(schedule);
  observer.observe(shell, { childList: true, subtree: true });
  place();
  return () => { observer.disconnect(); cancelAnimationFrame(frame); portal.remove(); onHost(null); };
}

export interface CompactComposer {
  readonly key: string;
  readonly scope: { readonly kind: string; readonly threadId?: string };
  readonly layout: "compact" | "expanded";
  readonly isEmpty: boolean;
  readonly isRunning: boolean;
}

/** One voice button and the compact form it belongs in, by index. */
export interface CompactHost {
  readonly key: string;
  readonly threadId: string;
  readonly canStart: boolean;
  readonly compactIndex: number;
  readonly compactCount: number;
}

/** A compact composer whose scope is a thread, so its id is present. */
export interface CompactThreadComposer extends CompactComposer {
  readonly scope: { readonly kind: "thread"; readonly threadId: string };
}

/** The composers on screen that bb is drawing compact, and that we can host. */
export function compactThreadComposers(
  composers: readonly CompactComposer[],
): CompactThreadComposer[] {
  return composers.filter(
    (composer): composer is CompactThreadComposer =>
      composer.layout === "compact" && composer.scope.kind === "thread" && !!composer.scope.threadId,
  );
}

/**
 * Pair each thread composer bb is drawing compact with a compact form.
 *
 * Returns null when the pairing cannot be trusted: no compact thread composer
 * on screen, or a form count that disagrees with ours (a composer we don't
 * host is in the way). Rendering nothing in that case leaves bb's own mic and
 * send working, which is better than a button in the wrong composer.
 */
export function planCompactHosts(
  composers: readonly CompactComposer[],
  formCount: number,
): CompactHost[] | null {
  const compact = compactThreadComposers(composers);
  if (!compact.length || formCount !== compact.length) return null;
  return compact.map((composer, index) => ({
    key: composer.key,
    threadId: composer.scope.threadId,
    canStart: composer.isEmpty && !composer.isRunning,
    compactIndex: index,
    compactCount: compact.length,
  }));
}
