import sodium from "libsodium-wrappers";

export async function computeSafetyNumber(
  publicKeyA: Uint8Array,
  publicKeyB: Uint8Array,
  rootKey: Uint8Array
): Promise<string> {
  await sodium.ready;
  const [first, second] = [publicKeyA, publicKeyB].sort((a, b) =>
    sodium.to_hex(a).localeCompare(sodium.to_hex(b))
  );
  // Bind the number to the derived session, not just the relayed public keys: a
  // one-way commitment to the hybrid root key (which includes the ML-KEM secret).
  // A relay that swaps keys or strips PQ back to classical changes the derived
  // root -> changes the digits the two humans compare. rootKey is never exposed;
  // only this domain-separated hash of it enters the number.
  const confirmTag = sodium.crypto_generichash(
    32,
    sodium.from_string("TTr:sas-confirm:v3"),
    rootKey
  );
  const domain = sodium.from_string("TTr:sas:v3");
  const combined = new Uint8Array(domain.length + first.length + second.length + confirmTag.length);
  combined.set(domain, 0);
  combined.set(first, domain.length);
  combined.set(second, domain.length + first.length);
  combined.set(confirmTag, domain.length + first.length + second.length);
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
