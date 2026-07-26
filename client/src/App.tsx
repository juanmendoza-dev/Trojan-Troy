// client/src/App.tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { parseInviteCode } from "./net/inviteLink";
import {
  ChatSessionController,
  type ChatSessionHandle,
  type ChatSessionSummary,
  type InitialAction,
} from "./session/ChatSessionController";
import { canAddSession, nextSessionLabel } from "./protocol/chatSessions";
import { StartJoinScreen } from "./screens/StartJoinScreen";
import { WaitingScreen } from "./screens/WaitingScreen";
import { SafetyNumberScreen } from "./screens/SafetyNumberScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { LoadingScreen } from "./screens/loading/LoadingScreen";
import { HandshakeJourney } from "./screens/HandshakeJourney";
import { ErrorScreen } from "./screens/ErrorScreen";
import { ChatList, type ChatListRow } from "./components/ChatList";
import { NewChatModal } from "./components/NewChatModal";
import { ProfileModal } from "./components/ProfileModal";
import { resolveActiveProfile, ANONYMOUS_ID, type Profile } from "./profiles/profileModel";
import {
  listProfiles,
  putProfile,
  deleteProfile,
  getActiveProfileId,
  getShareProfile,
  setActiveProfileId as persistActiveProfileId,
  setShareProfile as persistShareProfile,
} from "./profiles/profileStore";
import { useTheme } from "./theme/ThemeContext";
import { parseScreenOverride } from "./dev/screenOverride";
import "./AppShell.css";

const GHOST_MODE_STORAGE_KEY = "trojan-troy-ghost-mode";

interface SessionEntry {
  id: string;
  initialAction: InitialAction;
  label: string;
}

export default function App() {
  const devOverride = import.meta.env.DEV ? parseScreenOverride(window.location.search) : null;
  const { setTheme } = useTheme();
  useEffect(() => {
    if (devOverride?.theme) setTheme(devOverride.theme);
  }, []);

  const [initialJoinCode] = useState<string | null>(() => parseInviteCode(window.location.hash));
  useEffect(() => {
    if (initialJoinCode && window.location.hash) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>(() => getActiveProfileId());
  const [profilesOpen, setProfilesOpen] = useState(false);
  const activeProfile = resolveActiveProfile(profiles, activeProfileId);
  useEffect(() => {
    void listProfiles().then(setProfiles);
  }, []);
  function selectProfile(id: string) {
    persistActiveProfileId(id);
    setActiveProfileId(id);
  }
  async function handleCreateProfile(profile: Profile) {
    await putProfile(profile);
    setProfiles(await listProfiles());
    selectProfile(profile.id);
  }
  async function handleDeleteProfile(id: string) {
    await deleteProfile(id);
    setProfiles(await listProfiles());
    if (activeProfileId === id) selectProfile(ANONYMOUS_ID);
  }

  const [shareProfile, setShareProfile] = useState<boolean>(() => getShareProfile());
  function updateShareProfile(next: boolean) {
    persistShareProfile(next);
    setShareProfile(next);
  }
  const [ghostMode, setGhostMode] = useState<boolean>(
    () => localStorage.getItem(GHOST_MODE_STORAGE_KEY) === "true"
  );
  function updateGhostMode(next: boolean) {
    localStorage.setItem(GHOST_MODE_STORAGE_KEY, String(next));
    setGhostMode(next);
  }

  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, ChatSessionSummary>>({});
  const [newChatOpen, setNewChatOpen] = useState(false);
  const nextOrdinalRef = useRef(1);
  const handlesRef = useRef<Map<string, ChatSessionHandle>>(new Map());

  function addSession(initialAction: InitialAction) {
    if (!canAddSession(sessions.length)) return;
    const id = crypto.randomUUID();
    const label = nextSessionLabel(nextOrdinalRef.current++);
    setSessions((prev) => [...prev, { id, initialAction, label }]);
    setActiveId(id);
    setNewChatOpen(false);
  }

  const handleSummaryChange = useCallback((id: string, summary: ChatSessionSummary) => {
    setSummaries((prev) => {
      const existing = prev[id];
      if (existing && existing.status === summary.status && existing.unreadPreview === summary.unreadPreview) {
        return prev;
      }
      return { ...prev, [id]: summary };
    });
  }, []);

  const handleSessionClosed = useCallback((id: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setSummaries((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    handlesRef.current.delete(id);
  }, []);

  // If the active chat just closed, fall back to whichever chat remains.
  useEffect(() => {
    if (activeId && !sessions.some((s) => s.id === activeId)) {
      setActiveId(sessions.length > 0 ? sessions[sessions.length - 1].id : null);
    }
  }, [sessions, activeId]);

  const handleCloseRow = useCallback((id: string) => {
    handlesRef.current.get(id)?.close();
  }, []);

  const handleRename = useCallback((id: string, label: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)));
  }, []);

  if (devOverride?.screen === "loading") {
    return (
      <HandshakeJourney activeKey="handshake">
        <LoadingScreen roomCode="K7F-2QX" />
      </HandshakeJourney>
    );
  }
  if (devOverride?.screen === "chat") {
    return (
      <HandshakeJourney activeKey="chat">
        <ChatScreen
          roomCode="K7F-2QX"
          safetyNumber="21934 07741 66012"
          messages={[
            { id: "1", timestamp: Date.now() - 3000, from: "peer", kind: "text", text: "did you check the safety number?" },
            {
              id: "2",
              timestamp: Date.now() - 2000,
              from: "me",
              kind: "text",
              text: "yep — 21934 07741 66012 — matches on my end",
              status: "delivered",
            },
            {
              id: "3",
              timestamp: Date.now() - 1000,
              from: "me",
              kind: "text",
              text: "got it — nothing between us but ciphertext.",
              status: "read",
            },
          ]}
          ghostMode={ghostMode}
          onGhostModeChange={() => {}}
          shareProfile={false}
          onShareProfileChange={() => {}}
          selfCard={{ name: "You", avatar: null, device: "computer" }}
          peerProfile={{ name: "Jay", avatar: null, device: "phone" }}
          peerPresence="typing"
          onPresence={() => {}}
          onSend={() => {}}
          onSendVoice={() => {}}
          onLeave={() => {}}
        />
      </HandshakeJourney>
    );
  }
  if (devOverride?.screen === "waiting") {
    return <WaitingScreen roomCode="K7F-2QX" onCancel={() => {}} />;
  }
  if (devOverride?.screen === "safety") {
    return (
      <HandshakeJourney activeKey="safety-number">
        <SafetyNumberScreen
          roomCode="K7F-2QX"
          safetyNumber="21934 07741 66012 88304 55120 09937 41028 77650 30291 66104 82255 19073"
          onVerified={() => {}}
          onMismatch={() => {}}
        />
      </HandshakeJourney>
    );
  }
  if (devOverride?.screen === "connecting") {
    return (
      <StartJoinScreen
        onStart={() => {}}
        onJoin={() => {}}
        connectStatus="connecting"
        activeProfile={{ kind: "anonymous" }}
        onOpenProfiles={() => {}}
      />
    );
  }
  if (devOverride?.screen === "profiles") {
    const sample: Profile[] = [
      { id: "s1", name: "Jay", avatar: null, pinSalt: "", pinHash: "", createdAt: 0 },
      { id: "s2", name: "Work", avatar: null, pinSalt: "", pinHash: "", createdAt: 0 },
    ];
    return (
      <>
        <StartJoinScreen
          onStart={() => {}}
          onJoin={() => {}}
          connectStatus="idle"
          activeProfile={{ kind: "anonymous" }}
          onOpenProfiles={() => {}}
        />
        <ProfileModal
          profiles={sample}
          activeId={ANONYMOUS_ID}
          onSelectAnonymous={() => {}}
          onSelectNamed={() => {}}
          onCreate={() => {}}
          onDelete={() => {}}
          onClose={() => {}}
        />
      </>
    );
  }
  if (devOverride?.screen === "error") {
    const scenario = devOverride.scenario ?? "friend_left";
    const retryable = scenario === "server_unreachable" || scenario === "bad_code" || scenario === "room_full";
    return <ErrorScreen scenario={scenario} onNewChat={() => {}} onRetry={retryable ? () => {} : undefined} />;
  }

  if (sessions.length === 0) {
    return (
      <>
        <StartJoinScreen
          onStart={() => addSession({ kind: "start" })}
          onJoin={(code) => addSession({ kind: "join", roomCode: code })}
          connectStatus="idle"
          initialCode={initialJoinCode ?? undefined}
          activeProfile={activeProfile}
          onOpenProfiles={() => setProfilesOpen(true)}
        />
        {profilesOpen && (
          <ProfileModal
            profiles={profiles}
            activeId={activeProfileId}
            onSelectAnonymous={() => selectProfile(ANONYMOUS_ID)}
            onSelectNamed={(profile) => selectProfile(profile.id)}
            onCreate={handleCreateProfile}
            onDelete={handleDeleteProfile}
            onClose={() => setProfilesOpen(false)}
          />
        )}
      </>
    );
  }

  const rows: ChatListRow[] = sessions.map((s) => ({
    id: s.id,
    label: s.label,
    status: summaries[s.id]?.status ?? "connecting",
    unreadPreview: summaries[s.id]?.unreadPreview ?? null,
  }));

  return (
    <div className="app-shell">
      <ChatList
        rows={rows}
        activeId={activeId}
        canAddNew={canAddSession(sessions.length)}
        onSelect={setActiveId}
        onClose={handleCloseRow}
        onRename={handleRename}
        onNewChat={() => setNewChatOpen(true)}
      />
      <div className="app-shell__content">
        {sessions.map((s) => (
          <div key={s.id} style={{ display: s.id === activeId ? "contents" : "none" }}>
            <ChatSessionController
              ref={(handle) => {
                if (handle) handlesRef.current.set(s.id, handle);
                else handlesRef.current.delete(s.id);
              }}
              initialAction={s.initialAction}
              isActive={s.id === activeId}
              activeProfile={activeProfile}
              shareProfile={shareProfile}
              onShareProfileChange={updateShareProfile}
              ghostMode={ghostMode}
              onGhostModeChange={updateGhostMode}
              onSummaryChange={(summary) => handleSummaryChange(s.id, summary)}
              onClosed={() => handleSessionClosed(s.id)}
            />
          </div>
        ))}
      </div>
      {newChatOpen && (
        <NewChatModal
          onStart={() => addSession({ kind: "start" })}
          onJoin={(code) => addSession({ kind: "join", roomCode: code })}
          activeProfile={activeProfile}
          onOpenProfiles={() => setProfilesOpen(true)}
          onClose={() => setNewChatOpen(false)}
        />
      )}
      {profilesOpen && (
        <ProfileModal
          profiles={profiles}
          activeId={activeProfileId}
          onSelectAnonymous={() => selectProfile(ANONYMOUS_ID)}
          onSelectNamed={(profile) => selectProfile(profile.id)}
          onCreate={handleCreateProfile}
          onDelete={handleDeleteProfile}
          onClose={() => setProfilesOpen(false)}
        />
      )}
    </div>
  );
}
