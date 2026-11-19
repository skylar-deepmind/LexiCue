import type { Material } from '../lib/materials';
import { materialCover } from '../lib/materialCover';
import MaterialCover from './MaterialCover';
import EmptyLibraryArtwork from './EmptyLibraryArtwork';

/** A category's artwork is a live collage of its own materials. */
export default function LibraryCover({ files }: { files: Material[] }) {
  const covers = files.slice(0, 4);
  if (!covers.length) return <EmptyLibraryArtwork/>;
  return <span className="library-cover-collage" data-count={covers.length} aria-hidden="true">
    {covers.map(file => <MaterialCover key={file.id} src={materialCover(file)} identity={file.content_hash}/>)}
  </span>;
}
