import { imageSrc } from './images';

/** Whether a background picture is one of the app's own (`public/backgrounds`), not an image of the vault. */
export function isAppBackground(src: string): boolean {
  return /^\/backgrounds\/[a-z0-9_]+\.webp$/.test(src);
}

/**
 * A background picture's reference as a URL to show: one of the app's own as
 * it is, anything else through `imageSrc()`, which passes only a stored image
 * or an inline source and gives `''` for the rest, so a foreign file cannot
 * make the stage load from elsewhere.
 */
export function altarBackgroundUrl(src: string): string {
  return isAppBackground(src) ? src : imageSrc(src);
}
