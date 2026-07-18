import sodium from "libsodium-wrappers";

export async function computeSafetyNumber(
  publicKeyA: Uint8Array,
  publicKeyB: Uint8Array
): Promise<string> {
  await sodium.ready;
  const [first, second] = [publicKeyA, publicKeyB].sort((a, b) =>
    sodium.to_hex(a).localeCompare(sodium.to_hex(b))
  );
  const combined = new Uint8Array(first.length + second.length);
  combined.set(first, 0);
  combined.set(second, first.length);
  const digest = sodium.crypto_generichash(20, combined);

  const decimal = Array.from(digest)
    .map((byte) => byte.toString().padStart(3, "0"))
    .join("");

  const groups: string[] = [];
  for (let i = 0; i < decimal.length; i += 5) {
    groups.push(decimal.slice(i, i + 5));
  }
  return groups.join(" ");
}
