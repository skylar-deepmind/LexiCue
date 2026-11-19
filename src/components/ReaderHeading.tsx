import type { Ref } from 'react';
import { bookmarkTitle } from '../lib/bookmarkDesk';
import { materialCover } from '../lib/materialCover';
import type { Material } from '../lib/materials';
import MaterialCover from './MaterialCover';

export default function ReaderHeading({ material, titleRef }: {
  material: Material;
  titleRef?: Ref<HTMLHeadingElement>;
}) {
  return <div className="approved-reader-title">
    <h1 ref={titleRef} className="reading-title" lang="en">{bookmarkTitle(material.name)}</h1>
    <MaterialCover src={materialCover(material)} identity={material.content_hash} className="folio-print"/>
  </div>;
}
