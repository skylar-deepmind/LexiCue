import { Link, useLocation, type LinkProps } from 'react-router-dom';
import { visitState } from '../lib/pageNavigation';

export default function VisitLink(props: LinkProps) {
  const location = useLocation();
  return <Link {...props} state={{ ...props.state, ...visitState(location) }} />;
}
