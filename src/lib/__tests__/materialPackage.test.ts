import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { unpackMaterialPackage } from '../materialPackageContents';

const zip = (...files: string[]) => zipSync(Object.fromEntries(files.map(file => [file, strToU8(file)])));
const text = (bytes?: Uint8Array) => new TextDecoder().decode(bytes);

describe('material package matching', () => {
  it('pairs same-name files within each folder and prefers audio over video', () => {
    const members = unpackMaterialPackage(zip('One/Lesson.SRT', 'One/lesson.PNG', 'One/lesson.M4A',
      'One/lesson.mp4', 'Two/lesson.vtt', 'Two/lesson.mp4', '__MACOSX/lesson.srt'));
    expect(members.map(member => [member.name, text(member.cover), text(member.audio)])).toEqual([
      ['Lesson.SRT', 'One/lesson.PNG', 'One/lesson.M4A'],
      ['lesson.vtt', '', 'Two/lesson.mp4'],
    ]);
  });

  it('associates a common English caption suffix with its cover and video', () => {
    const [member] = unpackMaterialPackage(zip('Episode.en-US.vtt', 'Episode.webp', 'Episode.webm'));
    expect(member.name).toBe('Episode.vtt');
    expect(text(member.document)).toBe('Episode.en-US.vtt');
    expect(text(member.audio)).toBe('Episode.webm');
  });

  it('supports documents with covers and rejects packages without learning material', () => {
    expect(unpackMaterialPackage(zip('book.pdf', 'book.jpg', 'unrelated.mp3'))[0])
      .toMatchObject({ name: 'book.pdf', audio: undefined });
    expect(() => unpackMaterialPackage(zip('only.mp4'))).toThrow('material_empty_package');
    expect(() => unpackMaterialPackage(zip('x.en.srt', 'x.en-US.srt', 'x.mp4'))).toThrow('material_ambiguous_package');
    expect(() => unpackMaterialPackage(zip('../x.srt'))).toThrow('material_unsafe_archive');
  });
});
