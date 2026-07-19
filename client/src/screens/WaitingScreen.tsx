interface WaitingScreenProps {
  roomCode: string;
}

export function WaitingScreen({ roomCode }: WaitingScreenProps) {
  return (
    <div>
      <h1>Waiting for your friend...</h1>
      <p>Share this code:</p>
      <code>{roomCode}</code>
    </div>
  );
}
