import { useState } from "react";
import {
  listContacts,
  setContactLabel,
  deleteContact,
  blockKey,
  unblockKey,
  blockedSet,
  shortFingerprint,
  exportRecoveryCode,
  hasPin,
  type ContactRecord,
} from "../identity/identity";
import "./identity.css";

// Manage saved contacts (rename with a local-only label, block, delete) and
// export the identity recovery code. Rendered as a full-screen overlay so it
// can be opened mid-session without tearing down an active chat.
export function ContactsScreen({ onBack }: { onBack: () => void }) {
  const [, force] = useState(0);
  const refresh = () => force((n) => n + 1);
  const contacts = listContacts();
  const blocked = [...blockedSet()];
  const [editing, setEditing] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [codePass, setCodePass] = useState("");
  const [code, setCode] = useState<string | null>(null);

  function nameOf(c: ContactRecord): string {
    return c.label || c.displayName || `Anon ${shortFingerprint(c.identityPublicKey)}`;
  }

  async function saveLabel(key: string) {
    await setContactLabel(key, labelDraft);
    setEditing(null);
    refresh();
  }
  async function handleBlock(key: string) {
    await blockKey(key);
    await deleteContact(key);
    refresh();
  }
  async function handleDelete(key: string) {
    await deleteContact(key);
    refresh();
  }
  async function handleUnblock(key: string) {
    await unblockKey(key);
    refresh();
  }
  async function showCode() {
    setCode(await exportRecoveryCode(codePass || undefined));
  }

  return (
    <div className="id-screen id-screen--overlay">
      <div className="id-card">
        <h1 className="id-card__title">Contacts</h1>
        <p className="id-card__subtitle">
          People you've verified. Labels stay on this device and are never sent to anyone.
        </p>

        {contacts.length === 0 ? (
          <p className="id-empty">No saved contacts yet.</p>
        ) : (
          <ul className="id-list">
            {contacts.map((c) => (
              <li key={c.identityPublicKey} className="id-contact">
                {editing === c.identityPublicKey ? (
                  <div className="id-row" style={{ flex: 1 }}>
                    <input
                      className="id-input"
                      value={labelDraft}
                      autoFocus
                      placeholder="Label"
                      onChange={(e) => setLabelDraft(e.target.value)}
                    />
                    <button className="id-button" onClick={() => saveLabel(c.identityPublicKey)}>
                      Save
                    </button>
                  </div>
                ) : (
                  <>
                    <div>
                      <div className="id-contact__name">{nameOf(c)}</div>
                      <div className="id-contact__meta">
                        {shortFingerprint(c.identityPublicKey)} · verified{" "}
                        {new Date(c.firstVerifiedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="id-contact__actions">
                      <button
                        className="id-chip"
                        onClick={() => {
                          setEditing(c.identityPublicKey);
                          setLabelDraft(c.label ?? "");
                        }}
                      >
                        Label
                      </button>
                      <button className="id-chip" onClick={() => handleBlock(c.identityPublicKey)}>
                        Block
                      </button>
                      <button
                        className="id-chip id-chip--danger"
                        onClick={() => handleDelete(c.identityPublicKey)}
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {blocked.length > 0 && (
          <>
            <label className="id-label">Blocked</label>
            <ul className="id-list">
              {blocked.map((key) => (
                <li key={key} className="id-contact">
                  <div className="id-contact__meta">{shortFingerprint(key)}</div>
                  <button className="id-chip" onClick={() => handleUnblock(key)}>
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <label className="id-label">Identity backup</label>
        {code ? (
          <>
            <div className="id-code">{code}</div>
            <p className="id-hint">
              Save this somewhere safe — it restores your identity. Treat it like a password.
              {hasPin() ? "" : " Tip: set an app-lock PIN, and add a passphrase above, so this backup isn't plaintext."}
            </p>
          </>
        ) : (
          <>
            <input
              className="id-input"
              type="password"
              value={codePass}
              placeholder="Optional passphrase to protect the backup"
              onChange={(e) => setCodePass(e.target.value)}
            />
            <button className="id-button id-button--ghost" onClick={showCode}>
              Show recovery code
            </button>
          </>
        )}

        <button className="id-button" onClick={onBack}>
          Done
        </button>
      </div>
    </div>
  );
}
