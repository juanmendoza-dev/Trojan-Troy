import defaultAvatarUrl from "../assets/default-avatar.jpg";

// The single bundled fallback picture (the taiyaki-hat cat) — used for
// Anonymous and any profile without an uploaded photo. See the spec.
export const defaultAvatar = defaultAvatarUrl;

export function avatarSrc(avatar: string | null): string {
  return avatar ?? defaultAvatar;
}

// Center-crop an uploaded image to a square and re-encode it small, so profile
// photos stay modest in IndexedDB (and in the shared card). Browser-only
// (canvas) — no unit test, per the project's "pure logic only" testing rule.
export async function downscaleToDataUrl(file: File, maxPx = 256): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = maxPx;
  canvas.height = maxPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) return defaultAvatar;
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, maxPx, maxPx);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}
