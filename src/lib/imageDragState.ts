import type { VaultImage } from '../types';
import { createDragChannel } from './dragChannel';

/** What a tile of "Images" carries while it is dragged: the stored file, and its row if it has one. */
export interface ImageDragItem {
  file: string;
  image: VaultImage | null;
}

/**
 * The image being dragged out of "Images", for whatever takes it (a canvas).
 * A pointer drag: the WebView has no HTML5 drag and drop.
 */
const channel = createDragChannel<ImageDragItem>();

export const setImageDragItem = channel.set;
export const getImageDragItem = channel.get;
export const subscribeImageDrag = channel.subscribe;
