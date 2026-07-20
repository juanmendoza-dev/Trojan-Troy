export type MessageStatus = "sent" | "delivered" | "read";

const STATUS_RANK: Record<MessageStatus, number> = { sent: 0, delivered: 1, read: 2 };

export function advanceStatus(current: MessageStatus, incoming: MessageStatus): MessageStatus {
  return STATUS_RANK[incoming] > STATUS_RANK[current] ? incoming : current;
}
