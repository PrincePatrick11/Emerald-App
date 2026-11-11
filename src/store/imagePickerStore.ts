import { create } from 'zustand';

/** What a place asks the picture picker for. */
export interface PickRequest {
  /** Several at once (a text) or exactly one (an image field). */
  multiple: boolean;
  resolve: (files: string[] | null) => void;
}

interface ImagePickerState {
  request: PickRequest | null;
}

/** The one open request; `ImagePickerHost` shows the dialog while there is one. */
export const useImagePickerStore = create<ImagePickerState>(() => ({ request: null }));

/**
 * Opens the picture picker (`ImagePickerModal`): pictures of "Images" or files
 * from the disk, stored and taken into "Images". Resolves with the stored
 * file names in their order, or `null` when cancelled. A second request
 * cancels the first.
 */
export function pickPictures({ multiple }: { multiple: boolean }): Promise<string[] | null> {
  return new Promise((resolve) => {
    useImagePickerStore.getState().request?.resolve(null);
    useImagePickerStore.setState({ request: { multiple, resolve } });
  });
}

/** Ends the open request with a result. */
export function settlePick(files: string[] | null): void {
  const { request } = useImagePickerStore.getState();
  useImagePickerStore.setState({ request: null });
  request?.resolve(files);
}
