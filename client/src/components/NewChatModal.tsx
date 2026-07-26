// client/src/components/NewChatModal.tsx
import { StartJoinScreen } from "../screens/StartJoinScreen";
import type { ActiveProfile } from "../profiles/profileModel";
import "./NewChatModal.css";

interface NewChatModalProps {
  onStart: () => void;
  onJoin: (code: string) => void;
  activeProfile: ActiveProfile;
  onOpenProfiles: () => void;
  onClose: () => void;
}

// Wraps the existing Start/Join screen as a modal for opening an additional
// chat while others stay open underneath (design spec Section 3). Reuses
// StartJoinScreen unchanged; onStart/onJoin close this modal and hand off to
// a new chat-list row immediately, before the connection even resolves — so
// there's nothing left for this modal to show progress for.
export function NewChatModal({ onStart, onJoin, activeProfile, onOpenProfiles, onClose }: NewChatModalProps) {
  return (
    <div className="new-chat-modal__backdrop" onClick={onClose}>
      <div className="new-chat-modal__panel" onClick={(event) => event.stopPropagation()}>
        <StartJoinScreen
          onStart={onStart}
          onJoin={onJoin}
          connectStatus="idle"
          activeProfile={activeProfile}
          onOpenProfiles={onOpenProfiles}
        />
      </div>
    </div>
  );
}
