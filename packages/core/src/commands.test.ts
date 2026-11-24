import { describe, expect, it } from "vitest";
import { splitCommand } from "./commands";

describe("splitCommand", () => {
  it("splits a leading command from its arguments", () => {
    expect(splitCommand("/review the auth change")).toEqual({ command: "/review", rest: " the auth change" });
    expect(splitCommand("/compact")).toEqual({ command: "/compact", rest: "" });
    expect(splitCommand("/plugin:skill\nmore")).toEqual({ command: "/plugin:skill", rest: "\nmore" });
  });

  it("does not take a path or a mid-text slash for a command", () => {
    expect(splitCommand("/tmp/out.txt is empty")).toBeNull();
    expect(splitCommand("run /review")).toBeNull();
    expect(splitCommand("/ alone")).toBeNull();
  });
});
