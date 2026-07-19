interface SafetyNumberScreenProps {
  safetyNumber: string;
  onVerified: () => void;
}

export function SafetyNumberScreen({ safetyNumber, onVerified }: SafetyNumberScreenProps) {
  return (
    <div>
      <h1>Verify safety number</h1>
      <p>Compare this number with your friend, out loud or on a separate channel:</p>
      <code>{safetyNumber}</code>
      <button onClick={onVerified}>Verified</button>
    </div>
  );
}
