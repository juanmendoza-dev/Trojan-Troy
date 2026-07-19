import sodium from "libsodium-wrappers";
import { encryptBytes, decryptBytes } from "./secretbox";

export async function encryptMessage(key: Uint8Array, plaintext: string): Promise<string> {
  await sodium.ready;
  return encryptBytes(key, sodium.from_string(plaintext));
}

export async function decryptMessage(key: Uint8Array, payload: string): Promise<string> {
  const plaintext = await decryptBytes(key, payload);
  await sodium.ready;
  return sodium.to_string(plaintext);
}
