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

export async function deriveSessionKeys(
  own: Keypair,
  peerPublicKey: Uint8Array,
  role: "initiator" | "responder"
): Promise<SessionKeys> {
  await sodium.ready;
  const result =
    role === "initiator"
      ? sodium.crypto_kx_client_session_keys(own.publicKey, own.privateKey, peerPublicKey)
      : sodium.crypto_kx_server_session_keys(own.publicKey, own.privateKey, peerPublicKey);
  return { rx: result.sharedRx, tx: result.sharedTx };
}
