import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { PendingRequests } from "../src/ui/pending-request.js";

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

    const pending = new PendingRequests().announce(
      ctx,
      "Requesting permission for Git interference...",
    );
    expect(messages).toEqual(["<accent>Requesting permission for Git interference..."]);

    pending.end();
    expect(messages).toEqual(["<accent>Requesting permission for Git interference...", undefined]);
  });

  it("restores once even when ended repeatedly", () => {
    const { ctx, messages } = harness();

    const pending = new PendingRequests().announce(ctx, "Requesting permission for Deploy...");
    pending.end();
    pending.end();

    expect(messages.filter((message) => message === undefined)).toHaveLength(1);
  });

  it("keeps the line on a pending request until the last one ends", () => {
    const { ctx, messages } = harness();
    const requests = new PendingRequests();

    const older = requests.announce(ctx, "Requesting permission for Git...");
    const newer = requests.announce(ctx, "Requesting permission for Deploy...");
    older.end();
    newer.end();

    expect(messages).toEqual([
      "<accent>Requesting permission for Git...",
      "<accent>Requesting permission for Deploy...",
      "<accent>Requesting permission for Deploy...",
      undefined,
    ]);
  });

  it("returns the line to the older request when the newer one is answered first", () => {
    const { ctx, messages } = harness();
    const requests = new PendingRequests();

    const older = requests.announce(ctx, "Requesting permission for Git...");
    const newer = requests.announce(ctx, "Requesting permission for Deploy...");
    newer.end();
    newer.end();
    older.end();

    expect(messages).toEqual([
      "<accent>Requesting permission for Git...",
      "<accent>Requesting permission for Deploy...",
      "<accent>Requesting permission for Git...",
      undefined,
    ]);
  });
});
