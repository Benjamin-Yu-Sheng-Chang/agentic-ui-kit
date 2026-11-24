import { clsx } from "clsx";
import { useIcons } from "../primitives/icons";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type React from "react";
import { IconButton } from "../primitives/button";
import { useLabels } from "../primitives/labels";
import { MenuTrigger, Popover } from "../primitives/menu";
import { DictationControls, type DictationState } from "./dictation";

export interface ComposerCompletion {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  /** Text inserted in place of `<trigger><query>`; defaults to `${trigger}${label} `. */
  insertText?: string;
}

export interface ComposerTrigger {
  /** Single trigger character, e.g. `"@"` or `"/"`. */
  char: string;
  items: readonly ComposerCompletion[];
}

interface ActiveMatch {
  trigger: ComposerTrigger;
  start: number;
  end: number;
  query: string;
  items: ComposerCompletion[];
}

/** Find an active `<trigger><query>` token ending at `caret`, preceded by start-of-input or whitespace. */
export function findComposerTrigger(
  text: string,
  caret: number,
  triggers: readonly ComposerTrigger[] | undefined,
): ActiveMatch | null {
  if (!triggers?.length || caret <= 0 || caret > text.length) return null;
  let pos = caret - 1;
  while (pos >= 0 && !/\s/.test(text[pos]!)) {
    pos -= 1;
  }
  const tokenStart = pos + 1;
  const token = text.slice(tokenStart, caret);
  if (!token) return null;
  const ch = token[0]!;
  const trigger = triggers.find((t) => t.char === ch);
  if (!trigger || !trigger.items.length) return null;
  const query = token.slice(1).toLowerCase();
  const prefix: ComposerCompletion[] = [];
  const rest: ComposerCompletion[] = [];
  for (const item of trigger.items) {
    const label = item.label.toLowerCase();
    const desc = item.description?.toLowerCase() ?? "";
    if (!query || label.startsWith(query)) {
      prefix.push(item);
    } else if (label.includes(query) || desc.includes(query)) {
      rest.push(item);
    }
  }
  const items = [...prefix, ...rest];
  return items.length ? { trigger, start: tokenStart, end: caret, query, items } : null;
}

export interface ComposerProps {
  onSubmit: (text: string) => void;
  /** Shown as a stop button while `busy`. */
  onStop?: () => void;
  /** A reply is streaming: the send button becomes stop, and Enter does not send. */
  busy?: boolean;
  /** Controlled text. Leave both unset to let the composer keep its own. */
  value?: string;
  onChange?: (text: string) => void;
  placeholder?: string;
  /**
   * "docked": under a chat in progress. "centered": the empty state, taller. "compact": one row, for
   * panels and inline use.
   */
  variant?: "docked" | "centered" | "compact";
  /** Left of the toolbar, e.g. `<AttachButton>` and toggles. */
  leading?: ReactNode;
  /** Right of the toolbar before send, e.g. `<ModelPicker>`. */
  trailing?: ReactNode;
  /** Above the text, e.g. attachment chips. */
  above?: ReactNode;
  /** Files pasted or dropped onto the composer. */
  onFiles?: (files: File[]) => void;
  /** Pasted text longer than `longPasteChars` goes here instead of into the box, e.g. as a card. */
  onLongPaste?: (text: string) => void;
  longPasteChars?: number;
  /** Allows sending with no text, e.g. when attachments are ready. */
  allowEmpty?: boolean;
  /** Holds sending back, e.g. while a file uploads. */
  submitDisabled?: boolean;
  isDisabled?: boolean;
  /** Trigger-character completion menus (`@`, `/`, ...), filtered as the user types. */
  triggers?: readonly ComposerTrigger[];
  /**
   * Set while the user dictates (from `useDictation().state`): the words fill the box as they are heard,
   * and a level meter, cancel and accept replace `trailing` and send.
   */
  dictation?: DictationState;
  autoFocus?: boolean;
  className?: string;
}

/** How long typing must pause before the completion menu matches the text again. */
const SETTLE_MS = 300;

/** Touch keyboards have no easy Shift+Enter, so there Enter adds a line and the button sends. */
const coarsePointer = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

/** The chat box: growing textarea, toolbar slots, send / stop. Enter sends, Shift+Enter adds a line. */
export function Composer({
  onSubmit,
  onStop,
  busy = false,
  value,
  onChange,
  placeholder,
  variant = "docked",
  leading,
  trailing,
  above,
  onFiles,
  onLongPaste,
  longPasteChars = 2000,
  allowEmpty = false,
  submitDisabled = false,
  isDisabled = false,
  triggers,
  dictation,
  autoFocus,
  className,
}: ComposerProps) {
  const icons = useIcons();
  const labels = useLabels();
  const listboxId = useId();
  const [own, setOwn] = useState("");
  const text = value ?? own;
  const setText = (next: string) => {
    if (value === undefined) setOwn(next);
    onChange?.(next);
  };
  const area = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<string | null>(null);

  const [settled, setSettled] = useState({ text: "", caret: 0 });
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const settle = (next: { text: string; caret: number }, now = false) => {
    clearTimeout(settleTimer.current);
    if (now) setSettled(next);
    else settleTimer.current = setTimeout(() => setSettled(next), SETTLE_MS);
  };
  useEffect(() => () => clearTimeout(settleTimer.current), []);

  // Matched on the text as it was at the last pause: while typing, the menu keeps its last list.
  const rawMatch = useMemo(
    () => (dictation || isDisabled ? null : findComposerTrigger(settled.text, settled.caret, triggers)),
    [settled, triggers, dictation, isDisabled],
  );
  const tokenKey = rawMatch ? `${rawMatch.start}:${rawMatch.trigger.char}:${rawMatch.query}` : null;
  const match = rawMatch && dismissedAt !== tokenKey ? rawMatch : null;
  const clampedIndex = match ? Math.min(activeIndex, match.items.length - 1) : 0;

  /** False when the text typed since the last pause no longer ends in a trigger token. */
  const acceptCompletion = (item: ComposerCompletion): boolean => {
    // The shown list may be from before the last keystrokes; the token to replace is the current one.
    const token = findComposerTrigger(text, caret, triggers);
    if (!match || !token || token.trigger.char !== match.trigger.char) return false;
    const replacement = item.insertText ?? `${token.trigger.char}${item.label} `;
    const next = `${text.slice(0, token.start)}${replacement}${text.slice(token.end)}`;
    const nextCaret = token.start + replacement.length;
    setText(next);
    setCaret(nextCaret);
    settle({ text: next, caret: nextCaret }, true);
    setActiveIndex(0);
    setDismissedAt(null);
    requestAnimationFrame(() => {
      if (area.current) {
        area.current.focus();
        area.current.setSelectionRange(nextCaret, nextCaret);
      }
    });
    return true;
  };

  // Grow with the text up to the CSS max height, then scroll. Re-measured when the variant's padding or
  // the pane's width changes; it only scrolls once the text is taller than the max height.
  const fit = useCallback(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    el.style.overflowY = el.scrollHeight > el.clientHeight + 1 ? "auto" : "hidden";
  }, []);
  useLayoutEffect(fit, [text, variant, fit]);
  useEffect(() => {
    const el = area.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth !== width) (width = el.clientWidth), fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  const [finishing, setFinishing] = useState(false);
  const joined = (words: string | undefined) => (words ? (text.trim() ? `${text.replace(/\s+$/, "")} ${words}` : words) : text);
  const acceptDictation = async () => {
    if (!dictation || finishing) return;
    const heard = dictation.transcript;
    setFinishing(true);
    try {
      const words = await dictation.onAccept();
      setText(joined(typeof words === "string" ? words : heard));
    } finally {
      setFinishing(false);
      area.current?.focus();
    }
  };

  const [dragging, setDragging] = useState(false);
  const canSend = !dictation && !busy && !isDisabled && !submitDisabled && (allowEmpty || text.trim().length > 0);
  const submit = () => {
    if (!canSend) return;
    onSubmit(text);
    setText("");
    setCaret(0);
    settle({ text: "", caret: 0 }, true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (match && !e.nativeEvent.isComposing) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((clampedIndex + 1) % match.items.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((clampedIndex - 1 + match.items.length) % match.items.length);
        return;
      }
      if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        const chosen = match.items[clampedIndex];
        if (chosen && acceptCompletion(chosen)) {
          e.preventDefault();
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedAt(tokenKey);
        return;
      }
    }
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || coarsePointer()) return;
    e.preventDefault();
    submit();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (files.length && onFiles) {
      e.preventDefault();
      onFiles(files);
      return;
    }
    const pasted = e.clipboardData.getData("text/plain");
    if (onLongPaste && pasted.length > longPasteChars) {
      e.preventDefault();
      onLongPaste(pasted);
    }
  };
  const dropProps = onFiles && {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      setDragging(false);
      onFiles([...e.dataTransfer.files]);
    },
  };

  const compact = variant === "compact";
  const action = dictation ? (
    <DictationControls dictation={dictation} onAccept={() => void acceptDictation()} finishing={finishing} />
  ) : busy ? (
    <IconButton label={labels.stop} variant="primary" onPress={onStop} className="rounded-[var(--chat-send-radius,var(--chat-radius-md))]! [&_svg]:size-3.5 [&_svg]:fill-current">
      {icons.stop}
    </IconButton>
  ) : (
    <IconButton label={labels.send} variant="primary" onPress={submit} isDisabled={!canSend} className="rounded-[var(--chat-send-radius,var(--chat-radius-md))]!">
      {icons.send}
    </IconButton>
  );

  return (
    <div
      className={clsx(
        "relative flex flex-col rounded-[var(--chat-composer-radius,1.25rem)] border border-chat-border bg-chat-surface font-chat-sans shadow-chat-popover",
        "focus-within:border-chat-border-strong",
        dragging && "border-chat-accent! border-dashed",
        compact ? "gap-1 p-2" : "gap-2 p-3",
        className,
      )}
      {...dropProps}
      onPointerDown={(e) => {
        // Clicks on the box's padding focus the text, like one big field.
        if (e.target === e.currentTarget) {
          e.preventDefault();
          area.current?.focus();
        }
      }}
    >
      {match && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Completions"
          className="absolute bottom-full left-0 z-40 mb-1.5 max-h-60 w-[min(24rem,100%)] overflow-y-auto rounded-chat-md border border-chat-popover-border bg-chat-popover p-1 text-chat-fg shadow-chat-popover"
        >
          {match.items.map((item, idx) => {
            const selected = idx === clampedIndex;
            return (
              <div
                key={item.id}
                id={`${listboxId}-${idx}`}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  acceptCompletion(item);
                }}
                className={clsx(
                  "flex cursor-pointer flex-col gap-0.5 rounded-chat-sm px-2.5 py-1.5 text-(length:--chat-ui-font-size)",
                  selected ? "bg-chat-hover text-chat-fg" : "text-chat-fg",
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{`${match.trigger.char}${item.label}`}</span>
                  {item.detail && <span className="truncate text-(length:--chat-ui-font-size-sm) text-chat-subtle">{item.detail}</span>}
                </div>
                {item.description && (
                  <span className="truncate text-(length:--chat-ui-font-size-sm) text-chat-muted">{item.description}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {above}
      <div className={clsx("flex gap-2", compact ? "items-end" : "flex-col")}>
        {compact && leading}
        <textarea
          ref={area}
          rows={1}
          value={dictation ? joined(dictation.transcript) : text}
          readOnly={!!dictation}
          onChange={(e) => {
            const nextCaret = e.target.selectionStart ?? e.target.value.length;
            setText(e.target.value);
            setCaret(nextCaret);
            setActiveIndex(0);
            settle({ text: e.target.value, caret: nextCaret });
          }}
          onSelect={(e) => {
            const nextCaret = e.currentTarget.selectionStart ?? 0;
            setCaret(nextCaret);
            settle({ text: e.currentTarget.value, caret: nextCaret });
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={dictation ? (finishing ? labels.transcribing : labels.listening) : (placeholder ?? labels.replyPlaceholder)}
          aria-label={labels.message}
          aria-autocomplete={triggers?.length ? "list" : undefined}
          aria-controls={match ? listboxId : undefined}
          aria-activedescendant={match ? `${listboxId}-${clampedIndex}` : undefined}
          disabled={isDisabled}
          autoFocus={autoFocus}
          className={clsx(
            "w-full resize-none bg-transparent px-1.5 text-chat-fg outline-none placeholder:text-chat-subtle",
            "text-base leading-relaxed [scrollbar-width:thin]",
            // cqh: a share of the chat pane's height, so a short pane keeps room for messages.
            compact ? "max-h-[min(10rem,30cqh)] py-1" : variant === "centered" ? "max-h-[min(24rem,45cqh)] min-h-12 pt-1" : "max-h-[min(18rem,35cqh)] min-h-6 pt-1",
          )}
        />
        {compact ? (
          <div className="flex shrink-0 items-center gap-1">
            {!dictation && trailing}
            {action}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <div className="flex min-w-0 flex-1 items-center gap-1">{leading}</div>
            {!dictation && trailing}
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

export interface AttachButtonProps {
  /** The menu, e.g. `<Menu aria-label="Add">...</Menu>`. */
  children: ReactNode;
  label?: string;
  /** Replaces the `+` icon. */
  icon?: ReactNode;
  /** On the button, e.g. `rounded-full border border-chat-border` for a ringed `+`. */
  className?: string;
  /** On the menu's popover, e.g. a width to span the composer: `w-[min(36rem,calc(100vw-2rem))]`. */
  menuClassName?: string;
}

/** The `+` button that opens the attach menu above the composer. */
export function AttachButton({ children, label, icon, className, menuClassName }: AttachButtonProps) {
  const icons = useIcons();
  const labels = useLabels();
  return (
    <MenuTrigger>
      <IconButton label={label ?? labels.addFiles} {...(className && { className })}>
        {icon ?? icons.attach}
      </IconButton>
      <Popover placement="top start" {...(menuClassName && { className: menuClassName })}>
        {children}
      </Popover>
    </MenuTrigger>
  );
}
