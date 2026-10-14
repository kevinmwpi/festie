import { Image, type ImageProps } from 'expo-image';
import React from 'react';

/**
 * Remembers whether the photo at `uri` failed to load, so the caller can fall back (to a monogram,
 * an icon). The failure is kept per URL: a recycled row showing another photo tries again, and a URL
 * that later changes (new upload) is retried.
 */
export function useImageFallback(uri: string | null | undefined): { showImage: boolean; onError: () => void } {
  const [failedUri, setFailedUri] = React.useState<string | null>(null);
  const onError = React.useCallback(() => setFailedUri(uri ?? null), [uri]);
  return { showImage: Boolean(uri) && failedUri !== uri, onError };
}

/**
 * A cached remote photo: expo-image with Festie's defaults (memory + disk cache, so a photo seen once
 * shows offline; cover fit; a short cross-fade; `recyclingKey` so a reused row never flashes the
 * previous photo). Decorative — hidden from screen readers, since the name it illustrates is always
 * next to it. Render it only while `useImageFallback(uri).showImage` holds and pass that `onError`.
 */
export function RemoteImage({ uri, onError, style }: { uri: string; onError: () => void; style: ImageProps['style'] }) {
  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit="cover"
      cachePolicy="memory-disk"
      transition={150}
      recyclingKey={uri}
      onError={onError}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}
