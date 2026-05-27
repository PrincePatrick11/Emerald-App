import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AltarRecord } from '../../types';

export function useAltarPreviewMap(altars: AltarRecord[]) {
  const [previewMap, setPreviewMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const pending = altars.filter((altar) =>
      !!altar.background_image_data &&
      !altar.background_image_data.startsWith('data:') &&
      !previewMap[altar.background_image_data]
    );

    pending.forEach((altar) => {
      invoke<string>('read_image_as_base64', { path: altar.background_image_data })
        .then((dataUrl) => {
          if (cancelled) return;
          setPreviewMap((current) => current[altar.background_image_data!] ? current : {
            ...current,
            [altar.background_image_data!]: dataUrl,
          });
        })
        .catch((error) => console.error('Failed to load altar background:', altar.background_image_data, error));
    });

    return () => { cancelled = true; };
  }, [altars, previewMap]);

  return previewMap;
}

export function useBackgroundPreview(source: string | null | undefined) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!source) {
      setPreview(null);
      return;
    }
    if (source.startsWith('data:')) {
      setPreview(source);
      return;
    }
    let cancelled = false;
    invoke<string>('read_image_as_base64', { path: source })
      .then((dataUrl) => { if (!cancelled) setPreview(dataUrl); })
      .catch((error) => {
        console.error('Failed to load background preview:', source, error);
        if (!cancelled) setPreview(null);
      });
    return () => { cancelled = true; };
  }, [source]);

  return preview;
}
