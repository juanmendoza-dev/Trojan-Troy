import type { FormEvent } from "react";

interface StartJoinScreenProps {
  onStart: () => void;
  onJoin: (code: string) => void;
}

export function StartJoinScreen({ onStart, onJoin }: StartJoinScreenProps) {
  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("roomCode") ?? "").trim().toUpperCase();
    if (code) onJoin(code);
  };

  return (
    <div>
      <h1>Trojan Troy</h1>
      <button onClick={onStart}>Start a chat</button>
      <form onSubmit={handleJoin}>
        <input name="roomCode" placeholder="Enter room code" />
        <button type="submit">Join a chat</button>
      </form>
    </div>
  );
}
