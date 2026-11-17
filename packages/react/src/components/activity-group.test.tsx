import type { ActivityPart } from "@agentic-ui-kit/core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChatTheme } from "../primitives/chat-theme";
import { defaultLabels } from "../primitives/labels";
import { ActivityGroup } from "./activity-group";
import { AssistantMessage } from "./messages";
import { ToolViewsProvider } from "./tools";

afterEach(cleanup);

const part = (status: "streaming" | "done"): ActivityPart[] => [{ type: "thinking", id: "t", text: "Hmm", status } as ActivityPart];

it("shows icons.activity while working and icons.activityDone after", () => {
  const icons = { activity: <i data-testid="busy" />, activityDone: <i data-testid="rest" /> };
  const { queryByTestId, rerender } = render(<ChatTheme icons={icons}><ActivityGroup parts={part("streaming")} /></ChatTheme>);
  expect(queryByTestId("busy")).toBeTruthy();
  rerender(<ChatTheme icons={icons}><ActivityGroup parts={part("done")} /></ChatTheme>);
  expect(queryByTestId("rest")).toBeTruthy();
  expect(queryByTestId("busy")).toBeNull();
});

it("shows no icon by default", () => {
  const { container } = render(<ActivityGroup parts={part("streaming")} />);
  expect(container.querySelector(".chat-activity-icon")).toBeNull();
});

const thought = (extra: object): ActivityPart[] => [{ type: "thinking", id: "t", text: "", status: "done", visibility: "hidden", ...extra } as ActivityPart];

it("opens a finished thought with no body to say the reasoning is not shown", () => {
  const { getByText } = render(<ActivityGroup parts={thought({ title: "Planning the search" })} />);
  const toggle = getByText("Planning the search").closest("button")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(getByText(defaultLabels.reasoningHidden)).toBeTruthy();
});

it("drops a finished thought with no body and no title", () => {
  const { container } = render(<ActivityGroup parts={thought({})} />);
  expect(container.textContent).toBe("");
});

it("keeps a still-streaming hidden thought expandable", () => {
  const { container } = render(<ActivityGroup parts={thought({ status: "streaming" })} />);
  expect(container.querySelector("button")).toBeTruthy();
});

it("makes a bare thought among other steps an expandable row", () => {
  const parts = [...thought({ title: "Just thinking" }), { type: "tool_call", id: "c", name: "search", status: "done", inputJson: "{}", title: "Searched" } as ActivityPart];
  const { getByText } = render(<ActivityGroup parts={parts} defaultExpanded />);
  expect(getByText("Just thinking").closest("button")).toBeTruthy();
  expect(getByText("Searched").closest("button")).toBeTruthy();
});

it("draws a frameless tool's detail without the bordered box", () => {
  const call: ActivityPart = { type: "tool_call", id: "t", name: "links", status: "done", inputJson: "" };
  const views = (frameless: boolean) => ({ links: { frameless, Detail: () => <ul data-testid="links" /> } });
  for (const frameless of [true, false]) {
    const { getByTestId, unmount } = render(<ToolViewsProvider tools={views(frameless)}><ActivityGroup parts={[call]} defaultExpanded /></ToolViewsProvider>);
    expect(getByTestId("links").parentElement?.className.includes("border")).toBe(!frameless);
    unmount();
  }
});

it("shows a streaming reply with no output yet as an expandable thinking row", () => {
  const message = { id: "a", parentId: null, role: "assistant", status: "streaming", createdAt: "2026-11-05T10:00:00Z", parts: [] } as const;
  const { getByText, queryByText, rerender } = render(<AssistantMessage message={{ ...message, parts: [] }} />);
  fireEvent.click(getByText(defaultLabels.thinking).closest("button")!);
  expect(getByText(defaultLabels.reasoningHidden)).toBeTruthy();
  rerender(<AssistantMessage message={{ ...message, parts: [{ type: "text", id: "t", text: "Hi", status: "streaming" }] }} />);
  expect(queryByText(defaultLabels.thinking)).toBeNull();
});
