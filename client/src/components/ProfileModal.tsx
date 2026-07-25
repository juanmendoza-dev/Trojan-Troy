import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ANONYMOUS_ID, type Profile } from "../profiles/profileModel";
import { isValidPin, hashPin, verifyPin, newSalt } from "../profiles/pin";
import { avatarSrc, defaultAvatar, downscaleToDataUrl } from "../profiles/avatar";
import { Icon } from "./Icon";
import "./ProfileModal.css";

interface ProfileModalProps {
  profiles: Profile[];
  activeId: string;
  onSelectAnonymous: () => void;
  /** Called only after the profile's PIN is entered correctly. */
  onSelectNamed: (profile: Profile) => void;
  onCreate: (profile: Profile) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

type View =
  | { name: "list" }
  | { name: "create" }
  | { name: "unlock"; profile: Profile }
  | { name: "confirm-delete"; profile: Profile };

const TITLES: Record<View["name"], string> = {
  list: "Profiles",
  create: "New profile",
  unlock: "Enter PIN",
  "confirm-delete": "Delete profile",
};

export function ProfileModal({
  profiles,
  activeId,
  onSelectAnonymous,
  onSelectNamed,
  onCreate,
  onDelete,
  onClose,
}: ProfileModalProps) {
  const [view, setView] = useState<View>({ name: "list" });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="profile-modal__backdrop" onClick={onClose}>
      <div className="profile-modal__panel" onClick={(event) => event.stopPropagation()}>
        <div className="profile-modal__header">
          {view.name !== "list" ? (
            <button
              className="profile-modal__back"
              onClick={() => setView({ name: "list" })}
              aria-label="Back"
            >
              <Icon name="chevron-left" size={18} />
            </button>
          ) : (
            <span className="profile-modal__header-spacer" />
          )}
          <span className="profile-modal__title">{TITLES[view.name]}</span>
          <button className="profile-modal__close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        {view.name === "list" && (
          <div className="profile-modal__grid">
            <button
              type="button"
              className={`profile-tile${activeId === ANONYMOUS_ID ? " profile-tile--active" : ""}`}
              onClick={() => {
                onSelectAnonymous();
                onClose();
              }}
            >
              <img className="profile-tile__avatar" src={defaultAvatar} alt="" />
              <span className="profile-tile__name">Anonymous</span>
            </button>

            {profiles.map((profile) => (
              <div
                key={profile.id}
                className={`profile-tile${activeId === profile.id ? " profile-tile--active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => setView({ name: "unlock", profile })}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setView({ name: "unlock", profile });
                }}
              >
                <img className="profile-tile__avatar" src={avatarSrc(profile.avatar)} alt="" />
                <span className="profile-tile__name">{profile.name}</span>
                <button
                  type="button"
                  className="profile-tile__delete"
                  aria-label={`Delete ${profile.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setView({ name: "confirm-delete", profile });
                  }}
                >
                  <Icon name="x" size={12} strokeWidth={2.25} />
                </button>
              </div>
            ))}

            <button
              type="button"
              className="profile-tile profile-tile--new"
              onClick={() => setView({ name: "create" })}
            >
              <span className="profile-tile__plus">
                <Icon name="plus" size={26} strokeWidth={1.75} />
              </span>
              <span className="profile-tile__name">New profile</span>
            </button>
          </div>
        )}

        {view.name === "create" && (
          <CreateView
            onCancel={() => setView({ name: "list" })}
            onCreate={(profile) => {
              onCreate(profile);
              onClose();
            }}
          />
        )}

        {view.name === "unlock" && (
          <UnlockView
            profile={view.profile}
            onCancel={() => setView({ name: "list" })}
            onUnlocked={(profile) => {
              onSelectNamed(profile);
              onClose();
            }}
          />
        )}

        {view.name === "confirm-delete" && (
          <div className="profile-modal__confirm">
            <img
              className="profile-modal__confirm-avatar"
              src={avatarSrc(view.profile.avatar)}
              alt=""
            />
            <p className="profile-modal__confirm-text">
              Forget <strong>{view.profile.name}</strong>? This removes it from this device.
            </p>
            <div className="profile-modal__confirm-actions">
              <button className="profile-modal__btn" onClick={() => setView({ name: "list" })}>
                Cancel
              </button>
              <button
                className="profile-modal__btn profile-modal__btn--danger"
                onClick={() => {
                  onDelete(view.profile.id);
                  setView({ name: "list" });
                }}
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateView({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (profile: Profile) => void;
}) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setAvatar(await downscaleToDataUrl(file));
    } catch {
      setError("Couldn't read that image.");
    }
  }

  async function handleCreate() {
    if (!name.trim()) return setError("Give the profile a name.");
    if (!isValidPin(pin)) return setError("PIN must be exactly 4 digits.");
    if (pin !== confirm) return setError("The PINs don't match.");
    setBusy(true);
    const salt = await newSalt();
    const pinHash = await hashPin(pin, salt);
    onCreate({
      id: crypto.randomUUID(),
      name: name.trim(),
      avatar,
      pinSalt: salt,
      pinHash,
      createdAt: Date.now(),
    });
  }

  return (
    <div className="profile-form">
      <div className="profile-form__avatar-row">
        <img className="profile-form__avatar" src={avatarSrc(avatar)} alt="" />
        <div>
          <button
            type="button"
            className="profile-modal__btn"
            onClick={() => fileRef.current?.click()}
          >
            Upload photo
          </button>
          <p className="profile-form__hint">Or the default picture is used.</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleFile}
        />
      </div>

      <label className="profile-form__label">Name</label>
      <input
        className="profile-form__input"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Jay"
        maxLength={30}
        autoFocus
      />

      <label className="profile-form__label">4-digit PIN</label>
      <input
        className="profile-form__input profile-form__input--pin"
        value={pin}
        onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
        inputMode="numeric"
        placeholder="••••"
      />
      <input
        className="profile-form__input profile-form__input--pin"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value.replace(/\D/g, "").slice(0, 4))}
        inputMode="numeric"
        placeholder="Confirm PIN"
      />
      <p className="profile-form__note">
        The PIN locks this profile on this device — it doesn't encrypt your messages.
      </p>

      {error && <p className="profile-form__error">{error}</p>}

      <div className="profile-modal__confirm-actions">
        <button className="profile-modal__btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="profile-modal__btn profile-modal__btn--primary"
          onClick={handleCreate}
          disabled={busy}
        >
          Create
        </button>
      </div>
    </div>
  );
}

function UnlockView({
  profile,
  onCancel,
  onUnlocked,
}: {
  profile: Profile;
  onCancel: () => void;
  onUnlocked: (profile: Profile) => void;
}) {
  const [pin, setPin] = useState("");
  const [wrong, setWrong] = useState(false);

  async function submit() {
    if (await verifyPin(pin, profile.pinSalt, profile.pinHash)) {
      onUnlocked(profile);
    } else {
      setWrong(true);
      setPin("");
    }
  }

  return (
    <div className="profile-form profile-form--unlock">
      <img className="profile-form__avatar" src={avatarSrc(profile.avatar)} alt="" />
      <span className="profile-form__unlock-name">{profile.name}</span>
      <input
        className={`profile-form__input profile-form__input--pin${wrong ? " profile-form__input--wrong" : ""}`}
        value={pin}
        onChange={(event) => {
          setWrong(false);
          setPin(event.target.value.replace(/\D/g, "").slice(0, 4));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && pin.length === 4) void submit();
        }}
        inputMode="numeric"
        placeholder="••••"
        autoFocus
      />
      {wrong && <p className="profile-form__error">Wrong PIN — try again.</p>}
      <div className="profile-modal__confirm-actions">
        <button className="profile-modal__btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="profile-modal__btn profile-modal__btn--primary"
          onClick={() => void submit()}
          disabled={pin.length !== 4}
        >
          Unlock
        </button>
      </div>
    </div>
  );
}
