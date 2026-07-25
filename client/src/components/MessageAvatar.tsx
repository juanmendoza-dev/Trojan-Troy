import { avatarSrc } from "../profiles/avatar";
import "./MessageAvatar.css";

interface MessageAvatarProps {
  avatar: string | null;
  /** Opens the profile card, anchored to this avatar's on-screen box. */
  onOpen: (anchor: DOMRect) => void;
}

export function MessageAvatar({ avatar, onOpen }: MessageAvatarProps) {
  return (
    <button
      type="button"
      className="message-avatar"
      aria-label="View profile"
      onClick={(event) => onOpen(event.currentTarget.getBoundingClientRect())}
    >
      <img className="message-avatar__img" src={avatarSrc(avatar)} alt="" />
    </button>
  );
}
