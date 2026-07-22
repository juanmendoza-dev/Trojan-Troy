// Discord/iMessage-style grouping: an avatar is shown only on the LAST message
// of a consecutive run by the same sender (so it sits at the bottom-outer corner
// of the run). A decryption-error breaks any run. Pure + testable, in the spirit
// of messageStagger.ts.

export interface GroupItem {
  from?: "me" | "peer";
  kind: string;
}

function senderOf(message: GroupItem): "me" | "peer" | null {
  return message.kind === "decryption-error" ? null : message.from ?? null;
}

export function endsGroup(messages: GroupItem[], index: number): boolean {
  if (index >= messages.length - 1) return true;
  return senderOf(messages[index]) !== senderOf(messages[index + 1]);
}
