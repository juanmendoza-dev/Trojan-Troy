import "./SafetyNumberScreen.css";

interface SafetyNumberScreenProps {
  safetyNumber: string;
  onVerified: () => void;
  onMismatch: () => void;
}

export function SafetyNumberScreen({ safetyNumber, onVerified, onMismatch }: SafetyNumberScreenProps) {
  return (
    <div className="safety-number-screen">
      <h1>Verify safety number</h1>
      <p>Compare this number with your friend, out loud or on a separate channel:</p>
      <code>{safetyNumber}</code>
      <button onClick={onVerified}>It matches</button>
      <button onClick={onMismatch}>It doesn't match</button>
    </div>
  );
}
