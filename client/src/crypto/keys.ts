import sodium from "libsodium-wrappers";

export interface Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export interface SessionKeys {
  rx: Uint8Array;
  tx: Uint8Array;
}

export async function generateKeypair(): Promise<Keypair> {
  await sodium.ready;
  const kp = sodium.crypto_kx_keypair();
  return { publicKey: kp.publicKey, privateKey: kp.privateKey };
}

function kxSessionKeys(
  own: Keypair,
  peerPublicKey: Uint8Array,
  role: "initiator" | "responder"
): { rx: Uint8Array; tx: Uint8Array } {
  const result =
    role === "initiator"
      ? sodium.crypto_kx_client_session_keys(own.publicKey, own.privateKey, peerPublicKey)
      : sodium.crypto_kx_server_session_keys(own.publicKey, own.privateKey, peerPublicKey);
  return { rx: result.sharedRx, tx: result.sharedTx };
}

// Combine the identity-DH and ephemeral-DH outputs for one direction into a
// single session key (X3DH-lite). Concatenation is identity-first on both
// sides, so the initiator's tx still equals the responder's rx.
function combine(identityShared: Uint8Array, ephemeralShared: Uint8Array): Uint8Array {
  const combined = new Uint8Array(identityShared.length + ephemeralShared.length);
  combined.set(identityShared, 0);
  combined.set(ephemeralShared, identityShared.length);
  return sodium.crypto_generichash(sodium.crypto_generichash_BYTES, combined);
}

// Derive the session keys from BOTH the long-term identity exchange and this
// session's fresh ephemeral exchange, so the key is bound to the verified
// identity and can't be reproduced from either half alone.
export async function deriveSessionKeys(
  ownIdentity: Keypair,
  peerIdentityPublicKey: Uint8Array,
  ownEphemeral: Keypair,
  peerEphemeralPublicKey: Uint8Array,
  role: "initiator" | "responder"
): Promise<SessionKeys> {
  await sodium.ready;
  const identity = kxSessionKeys(ownIdentity, peerIdentityPublicKey, role);
  const ephemeral = kxSessionKeys(ownEphemeral, peerEphemeralPublicKey, role);
  return {
    rx: combine(identity.rx, ephemeral.rx),
    tx: combine(identity.tx, ephemeral.tx),
  };
}
