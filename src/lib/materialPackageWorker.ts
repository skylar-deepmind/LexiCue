import { unpackMaterialPackage } from './materialPackageContents';

self.onmessage = ({ data }: MessageEvent<Uint8Array>) => {
  try {
    const members = unpackMaterialPackage(data);
    const buffers = new Set<ArrayBufferLike>();
    for (const member of members) {
      buffers.add(member.document.buffer);
      if (member.cover) buffers.add(member.cover.buffer);
      if (member.audio) buffers.add(member.audio.buffer);
    }
    self.postMessage({ members }, { transfer: [...buffers] as Transferable[] });
  } catch (error) {
    self.postMessage({ error: String(error).match(/material_[a-z_]+/)?.[0] ?? 'material_invalid_document' });
  }
};
