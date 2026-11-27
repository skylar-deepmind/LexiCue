import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { allocatedCover } from '../lib/materialCover';
import { supportsMacLinkImport } from '../lib/importLink';

const covers = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
const coverUrl = /^https:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\/hqdefault\.jpg$/;

function loadCover(videoId: string): Promise<string | null> {
  const cached = covers.get(videoId);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(videoId);
  if (existing) return existing;
  const request = invoke<string | null>('material_youtube_artwork', { videoId })
    .then(image => image ?? (supportsMacLinkImport() ? invoke<string>('youtube_cover', { videoId }) : null))
    .then(image => {
      if (image) {
        if (covers.size >= 24) covers.delete(covers.keys().next().value!);
        covers.set(videoId, image);
      }
      return image;
    }).finally(() => pending.delete(videoId));
  pending.set(videoId, request);
  return request;
}

export default function MaterialCover({ src, identity, className = '' }: { src: string; identity: string; className?: string }) {
  const youtubeCover = coverUrl.exec(src)?.[1];
  const videoId = isTauri() ? youtubeCover : undefined;
  const [resolved, setResolved] = useState<{ videoId: string; image: string }>();
  const fallback = allocatedCover(identity);
  const image = videoId
    ? (resolved?.videoId === videoId ? resolved.image : covers.get(videoId)) ?? fallback
    : src.startsWith('https:') ? fallback : src;
  useEffect(() => {
    if (!videoId) return;
    let active = true;
    const retrieve = () => {
      void loadCover(videoId).then(result => {
        if (active && result) setResolved({ videoId, image: result });
      }).catch(() => {});
    };
    const changed = () => {
      covers.delete(videoId);
      // Let any in-flight lookup finish before reading the newly saved image.
      const inFlight = pending.get(videoId);
      if (inFlight) void inFlight.then(() => { covers.delete(videoId); if (active) retrieve(); }, () => { if (active) retrieve(); });
      else retrieve();
    };
    if (!covers.has(videoId)) retrieve();
    window.addEventListener('online', retrieve);
    window.addEventListener('lexicue-attachments-changed', changed);
    return () => {
      active = false;
      window.removeEventListener('online', retrieve);
      window.removeEventListener('lexicue-attachments-changed', changed);
    };
  }, [videoId]);
  return <img className={className} src={image} crossOrigin={image.startsWith('https:') ? 'anonymous' : undefined} alt="" draggable={false} onError={event => {
    if (!event.currentTarget.src.endsWith(fallback)) event.currentTarget.src = fallback;
  }}/>;
}
