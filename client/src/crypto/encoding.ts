import sodium from "libsodium-wrappers";

export async function toBase64(bytes: Uint8Array): Promise<string> {
  await sodium.ready;
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}

export async function fromBase64(value: string): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
}
