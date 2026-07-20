import { useState, type FormEvent } from "react";

interface StartJoinScreenProps {
  onStart: () => void;
  onJoin: (code: string) => void;
}

export function StartJoinScreen({ onStart, onJoin }: StartJoinScreenProps) {
  const [connecting, setConnecting] = useState<"start" | "join" | null>(null);

  const handleStart = () => {
    setConnecting("start");
    onStart();
  };

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("roomCode") ?? "").trim().toUpperCase();
    if (!code) return;
    setConnecting("join");
    onJoin(code);
  };

  return (
    <div>
      <h1>Trojan Troy</h1>
      <button onClick={handleStart} disabled={connecting !== null}>
        {connecting === "start" ? "Connecting…" : "Start a chat"}
      </button>
      <form onSubmit={handleJoin}>
        <input name="roomCode" placeholder="Enter room code" disabled={connecting !== null} />
        <button type="submit" disabled={connecting !== null}>
          {connecting === "join" ? "Connecting…" : "Join a chat"}
        </button>
      </form>
    </div>
  );
}
