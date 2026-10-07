import { useTranslation } from 'react-i18next';
import type { ExpressionMetadata } from '../lib/types';

/** Context-specific labels take precedence over general dictionary labels. */
export function ExpressionTags({ metadata }: { metadata?: ExpressionMetadata | null }) {
  const { t } = useTranslation();
  if (!metadata) return null;
  const tags = [...new Set([
    ...metadata.register_tags.filter(tag => ['informal', 'slang'].includes(tag)),
    ...metadata.regions.filter(tag => ['UK', 'US'].includes(tag)),
    ...metadata.cautions.filter(tag => tag === 'offensive'),
    ...metadata.domains.filter(tag => tag === 'language_learning'),
  ])];
  if (!tags.length) return null;
  return <div className="expression-tags" role="group" aria-label={t('expressionTags.label')}>
    {tags.map(tag => <span key={tag} className={`expression-tag${tag === 'offensive' ? ' expression-tag--caution' : ''}`}>{t(`expressionTags.${tag}`)}</span>)}
    {metadata.evidence_kind === 'model' && <span className="expression-tag expression-tag--inferred">{t('expressionTags.inferred')}</span>}
  </div>;
}
