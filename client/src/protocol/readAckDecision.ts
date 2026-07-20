export interface ReadAckInput {
  isFocused: boolean;
  isVisible: boolean;
  ghostMode: boolean;
  alreadyAcked: boolean;
}

export function shouldSendReadAck(input: ReadAckInput): boolean {
  if (input.ghostMode) return false;
  if (input.alreadyAcked) return false;
  return input.isFocused && input.isVisible;
}
