import type { ActiveProfile } from "../profiles/profileModel";
import { avatarSrc } from "../profiles/avatar";
import "./ProfileButton.css";

interface ProfileButtonProps {
  active: ActiveProfile;
  onClick: () => void;
}

export function ProfileButton({ active, onClick }: ProfileButtonProps) {
  const name = active.kind === "named" ? active.profile.name : "Anonymous";
  const avatar = active.kind === "named" ? active.profile.avatar : null;
  return (
    <button type="button" className="profile-button" onClick={onClick} aria-label="Profiles">
      <img className="profile-button__avatar" src={avatarSrc(avatar)} alt="" />
      <span className="profile-button__name">{name}</span>
    </button>
  );
}
