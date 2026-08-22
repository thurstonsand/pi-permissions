import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { announcePendingRequest } from "../src/ui/pending-request.js";

function harness(): { ctx: ExtensionContext; messages: (string | undefined)[] } {
  const messages: (string | undefined)[] = [];
  const ctx = {
    ui: {
      theme: { fg: (color: string, text: string) => `<${color}>${text}` },
      setWorkingMessage: (message?: string) => messages.push(message),
    },
  } as unknown as ExtensionContext;

  return { ctx, messages };
}

describe("pending request announcement", () => {
  it("claims the working line in accent and restores it when the request ends", () => {
    const { ctx, messages } = harness();

    const pending = announcePendingRequest(ctx, "Requesting permission for Git interference...");
    expect(messages).toEqual(["<accent>Requesting permission for Git interference..."]);

    pending.end();
    expect(messages).toEqual(["<accent>Requesting permission for Git interference...", undefined]);
  });

  it("restores once even when ended repeatedly", () => {
    const { ctx, messages } = harness();

    const pending = announcePendingRequest(ctx, "Requesting permission for Deploy...");
    pending.end();
    pending.end();

    expect(messages.filter((message) => message === undefined)).toHaveLength(1);
  });
});
