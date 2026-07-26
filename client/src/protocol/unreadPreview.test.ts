import { describe, expect, it } from "vitest";
import { formatUnreadPreview } from "./unreadPreview";
import type { ChatMessage } from "../screens/ChatScreen";

const textMessage: ChatMessage = { id: "1", timestamp: 0, from: "peer", kind: "text", text: "hey there" };
const voiceMessage: ChatMessage = {
  id: "2",
  timestamp: 0,
  from: "peer",
  kind: "voice",
  audioUrl: "blob:x",
  durationMs: 1200,
};
const errorMessage: ChatMessage = { id: "3", timestamp: 0, kind: "decryption-error" };

describe("formatUnreadPreview", () => {
  it("shows the text for a text message", () => {
    expect(formatUnreadPreview(textMessage, false)).toBe("hey there");
  });

  it("shows a generic label for a voice message", () => {
    expect(formatUnreadPreview(voiceMessage, false)).toBe("Voice message");
  });

  it("shows a dot only, regardless of message kind, when Ghost Mode is on", () => {
    expect(formatUnreadPreview(textMessage, true)).toBe("•");
    expect(formatUnreadPreview(voiceMessage, true)).toBe("•");
  });

  it("falls back to a generic label for a decryption-error message", () => {
    expect(formatUnreadPreview(errorMessage, false)).toBe("Message");
  });
});
