import { useTranslation } from 'react-i18next';
import { learningStage } from '../lib/fileProgress';

export default function LearningProgressRing({ value }: { value: number | null }) {
  const { t } = useTranslation();
  const percent = value === null ? null : Math.max(0, Math.min(100, value));
  const stage = learningStage(percent);
  const description = percent === null ? t('fileCard.noLearningContent') :
    `${t('learningRing.progress', { percent })} · ${t(`fileCard.stage.${stage}`)}. ${t('learningRing.calculation')}`;
  return <span className={`learning-ring learning-stage learning-stage-${stage ?? 'notStarted'}`} tabIndex={0}
    role={percent === null ? 'img' : 'progressbar'} aria-label={description}
    aria-valuemin={percent === null ? undefined : 0} aria-valuemax={percent === null ? undefined : 100}
    aria-valuenow={percent ?? undefined} aria-valuetext={description}>
    <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
      <circle className="learning-ring__track" cx="24" cy="24" r="20" />
      {percent !== null && percent > 0 && <circle className="learning-ring__fill" cx="24" cy="24" r="20"
        pathLength="100" strokeDasharray={`${percent} 100`} transform="rotate(-90 24 24)" />}
    </svg>
    <span className="learning-ring__value" aria-hidden="true">{percent === null ? '—' : `${percent}%`}</span>
    <span className="ui-tooltip" role="tooltip">{description}</span>
  </span>;
}
