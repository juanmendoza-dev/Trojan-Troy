import { useEffect, useRef, useState, type FormEvent } from "react";

interface StartJoinScreenProps {
  onStart: () => void;
  onJoin: (code: string) => void;
  initialCode?: string;
}

export function StartJoinScreen({ onStart, onJoin, initialCode }: StartJoinScreenProps) {
  const [connecting, setConnecting] = useState<"start" | "join" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // When we arrive from an invite link, prefill the code and highlight it so
  // the user just has to hit Join (rather than auto-connecting on page load).
  useEffect(() => {
    if (initialCode && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [initialCode]);

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
        <input
          ref={inputRef}
          name="roomCode"
          placeholder="Enter room code"
          defaultValue={initialCode ?? ""}
          disabled={connecting !== null}
        />
        <button type="submit" disabled={connecting !== null}>
          {connecting === "join" ? "Connecting…" : "Join a chat"}
        </button>
      </form>
    </div>
  );
}
