import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Composer, findComposerTrigger, type ComposerTrigger } from "./composer";

afterEach(cleanup);

const paste = (el: Element, data: { text?: string; files?: File[] }) =>
  fireEvent.paste(el, { clipboardData: { files: data.files ?? [], getData: () => data.text ?? "" } });

it("turns long pasted text into an attachment and keeps short pastes in the box", () => {
  const onLongPaste = vi.fn();
  render(<Composer onSubmit={() => {}} onLongPaste={onLongPaste} longPasteChars={10} />);
  const box = screen.getByLabelText("Message");
  paste(box, { text: "a long pasted paragraph" });
  expect(onLongPaste).toHaveBeenCalledWith("a long pasted paragraph");
  paste(box, { text: "short" });
  expect(onLongPaste).toHaveBeenCalledTimes(1);
});

it("hands pasted files to onFiles", () => {
  const onFiles = vi.fn();
  render(<Composer onSubmit={() => {}} onFiles={onFiles} />);
  const file = new File(["x"], "shot.png", { type: "image/png" });
  paste(screen.getByLabelText("Message"), { files: [file] });
  expect(onFiles).toHaveBeenCalledWith([file]);
});

it("sends on Enter, not Shift+Enter, and not while held back", () => {
  const onSubmit = vi.fn();
  const { rerender } = render(<Composer onSubmit={onSubmit} />);
  const box = screen.getByLabelText("Message");
  fireEvent.change(box, { target: { value: "hi" } });
  fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
  expect(onSubmit).not.toHaveBeenCalled();
  rerender(<Composer onSubmit={onSubmit} submitDisabled />);
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onSubmit).not.toHaveBeenCalled();
  rerender(<Composer onSubmit={onSubmit} />);
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onSubmit).toHaveBeenCalledWith("hi");
});

const TRIGGERS: ComposerTrigger[] = [
  {
    char: "@",
    items: [
      { id: "compact", label: "compact", description: "Compact conversation history", insertText: "/compact " },
      { id: "goal", label: "goal", description: "Run until goal completes", detail: "<goal>", insertText: "/goal " },
    ],
  },
];

it("matches trigger tokens only at start or after whitespace, never inside emails", () => {
  expect(findComposerTrigger("user@goal", 9, TRIGGERS)).toBeNull();
  const m = findComposerTrigger("please @go", 10, TRIGGERS);
  expect(m?.items.map((i) => i.id)).toEqual(["goal"]);
});

it("filters completions, navigates with arrows, inserts on Enter without submitting, and dismisses on Escape", () => {
  const onSubmit = vi.fn();
  const { getByRole, queryByRole } = render(<Composer onSubmit={onSubmit} triggers={TRIGGERS} />);
  const box = screen.getByLabelText("Message") as HTMLTextAreaElement;

  fireEvent.change(box, { target: { value: "@", selectionStart: 1 } });
  expect(getByRole("listbox")).toBeTruthy();

  fireEvent.keyDown(box, { key: "ArrowDown" });
  fireEvent.keyDown(box, { key: "Enter" });
  expect(onSubmit).not.toHaveBeenCalled();
  expect(box.value).toBe("/goal ");
  expect(queryByRole("listbox")).toBeNull();

  fireEvent.change(box, { target: { value: "/goal @co", selectionStart: 9 } });
  expect(getByRole("listbox")).toBeTruthy();
  fireEvent.keyDown(box, { key: "Escape" });
  expect(queryByRole("listbox")).toBeNull();
});
