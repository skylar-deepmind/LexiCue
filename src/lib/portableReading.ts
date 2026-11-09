import { invoke } from '@tauri-apps/api/core';
import type { Material } from './materials';
import { positionMatchesMaterial } from './readingDesk';
import type { TagInfo } from './types';

import {TAG_TONES} from './tagAppearance';

export async function migrateLocalReading(files: Material[]) {
    const keyFor = (file:Material) => file.source?.key ?? file.document?.identity ?? file.content_hash;
    const seen = new Map<string,number>();
    for (const file of files) seen.set(keyFor(file),(seen.get(keyFor(file)) ?? 0)+1);
    for (const file of files) {
        if (file.position) continue;
        const key = keyFor(file);
        // Several independently imported materials can share one legacy cache key.
        if (seen.get(key) !== 1) continue;
        try {
            const old = JSON.parse(localStorage.getItem(`lexicue-reader-state:${key}`) ?? 'null');
            if (!positionMatchesMaterial(old,file,key) || !Number.isSafeInteger(old.segment) || old.segment < 0) continue;
            const revision = await invoke<string|null>('remember_reading_position', {fileId:file.id,segment:old.segment,contentHash:file.content_hash,legacy:true,back:false,parent:null});
            if (revision) file.position = {segment:old.segment, revision};
        } catch { /* Retry on the next successful library load. */ }
    }
}

export async function migrateTagColors(tags: TagInfo[]) {
    let saved: Record<string,unknown>;
    try { saved = JSON.parse(localStorage.getItem('lexicue-preferences') ?? '{}').state?.tagColors ?? {}; }
    catch { return; }
    for (const tag of tags) {
        const tone = saved[tag.name.trim().toLowerCase()];
        if (tag.tone || !TAG_TONES.some(value=>value === tone)) continue;
        await invoke('set_tag_tone',{tagId:tag.id,tone,onlyIfUnset:true});
        tag.tone = tone as string;
    }
}
