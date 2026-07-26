// client/src/components/ChatList.tsx
import { useState } from "react";
import { Icon } from "./Icon";
import "./ChatList.css";

export interface ChatListRow {
  id: string;
  label: string;
  status: "connecting" | "waiting" | "handshake" | "safety-number" | "chat" | "error";
  unreadPreview: string | null;
}

interface ChatListProps {
  rows: ChatListRow[];
  activeId: string | null;
  canAddNew: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onNewChat: () => void;
}

const STATUS_LABEL: Record<ChatListRow["status"], string> = {
  connecting: "Connecting…",
  waiting: "Waiting for peer…",
  handshake: "Sealing the line…",
  "safety-number": "Verify to continue",
  chat: "Live",
  error: "Disconnected",
};

export function ChatList({ rows, activeId, canAddNew, onSelect, onClose, onRename, onNewChat }: ChatListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");

  function startEditing(row: ChatListRow) {
    setEditingId(row.id);
    setDraftLabel(row.label);
  }
  function commitEditing() {
    if (editingId && draftLabel.trim()) onRename(editingId, draftLabel.trim());
    setEditingId(null);
  }

  return (
    <div className="chat-list">
      <button type="button" className="chat-list__new" onClick={onNewChat} disabled={!canAddNew}>
        <Icon name="plus" size={16} strokeWidth={2.25} />
        New chat
      </button>
      <div className="chat-list__rows">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`chat-list__row${row.id === activeId ? " chat-list__row--active" : ""}`}
            onClick={() => onSelect(row.id)}
          >
            <div className="chat-list__row-top">
              {editingId === row.id ? (
                <input
                  className="chat-list__label-input"
                  value={draftLabel}
                  autoFocus
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setDraftLabel(event.target.value)}
                  onBlur={commitEditing}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitEditing();
                    if (event.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span className="chat-list__label">{row.label}</span>
              )}
              <button
                type="button"
                className="chat-list__icon-button"
                aria-label={`Rename ${row.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  startEditing(row);
                }}
              >
                <Icon name="pencil" size={12} />
              </button>
              <button
                type="button"
                className="chat-list__icon-button"
                aria-label={`Close ${row.label}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(row.id);
                }}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
            <div className="chat-list__row-bottom">
              <span className={`chat-list__status chat-list__status--${row.status}`}>{STATUS_LABEL[row.status]}</span>
              {row.unreadPreview && row.id !== activeId && (
                <span className="chat-list__unread">
                  <span className="chat-list__unread-dot" aria-hidden="true" />
                  {row.unreadPreview}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
