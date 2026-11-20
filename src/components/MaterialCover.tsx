import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { allocatedCover } from '../lib/materialCover';
import { isAppleStoreBuild } from '../lib/distribution';

const covers = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const coverUrl = /^https:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\/hqdefault\.jpg$/;

function loadCover(videoId: string): Promise<string> {
  const cached = covers.get(videoId);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(videoId);
  if (existing) return existing;
  const request = invoke<string>('youtube_cover', { videoId }).then(image => {
    if (covers.size >= 24) covers.delete(covers.keys().next().value!);
    covers.set(videoId, image);
    return image;
  }).finally(() => pending.delete(videoId));
  pending.set(videoId, request);
  return request;
}

export default function MaterialCover({ src, identity, className = '' }: { src: string; identity: string; className?: string }) {
  const youtubeCover = coverUrl.exec(src)?.[1];
  const videoId = isTauri() && !isAppleStoreBuild ? youtubeCover : undefined;
  const [resolved, setResolved] = useState<{ videoId: string; image: string }>();
  const fallback = allocatedCover(identity);
  const image = videoId
    ? (resolved?.videoId === videoId ? resolved.image : covers.get(videoId)) ?? fallback
    : isAppleStoreBuild && youtubeCover ? fallback : src;
  useEffect(() => {
    if (!videoId || covers.has(videoId)) return;
    let active = true;
    const retrieve = () => {
      void loadCover(videoId).then(result => {
        if (active) setResolved({ videoId, image: result });
      }).catch(() => {});
    };
    retrieve();
    window.addEventListener('online', retrieve);
    return () => {
      active = false;
      window.removeEventListener('online', retrieve);
    };
  }, [videoId]);
  return <img className={className} src={image} crossOrigin={image.startsWith('https:') ? 'anonymous' : undefined} alt="" draggable={false} onError={event => {
    if (!event.currentTarget.src.endsWith(fallback)) event.currentTarget.src = fallback;
  }}/>;
}
