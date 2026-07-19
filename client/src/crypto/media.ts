import { encryptBytes, decryptBytes } from "./secretbox";

export async function encryptVoiceClip(key: Uint8Array, blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return encryptBytes(key, bytes);
}

export async function decryptVoiceClip(
  key: Uint8Array,
  payload: string,
  mimeType: string
): Promise<Blob> {
  const bytes = await decryptBytes(key, payload);
  return new Blob([new Uint8Array(bytes)], { type: mimeType });
}
