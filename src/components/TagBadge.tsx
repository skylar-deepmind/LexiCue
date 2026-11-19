import './card-tags.css';
export default function TagBadge({name}:{name:string;tone?:string|null}) {
  return <span className="file-tag tag-paper">{name}</span>;
}
