import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

interface Profile { tier: number | null; }

const INTRO_SEEN_KEY = 'lexicue-frequency-baseline-intro-seen';

export default function FrequencyBaselineIntro() {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(INTRO_SEEN_KEY) === 'true') return;
    let active = true;

    void Promise.all(['en', 'zh'].map((language) =>
      invoke<Profile>('get_frequency_baseline', { language }),
    )).then((profiles) => {
      if (!active) return;
      // A stopped baseline still has a tier, so it counts as configured.
      localStorage.setItem(INTRO_SEEN_KEY, 'true');
      if (profiles.every((profile) => profile.tier === null)) setVisible(true);
    }).catch((error) => {
      console.error('Failed to check frequency baselines:', error);
    });

    return () => { active = false; };
  }, []);

  if (!visible) return null;

  return (
    <section className="frequency-baseline-intro mx-6 mt-3 flex flex-wrap items-center gap-3 rounded-xl px-4 py-3" aria-labelledby="frequency-baseline-intro-title">
      <BarChart3 size={20} className="frequency-baseline-intro__icon shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h2 id="frequency-baseline-intro-title" className="text-sm font-semibold">{t('frequencyBaseline.introTitle')}</h2>
        <p className="mt-0.5 text-sm">{t('frequencyBaseline.introDescription')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/settings#frequency-baseline" className="frequency-baseline-intro__action rounded-lg px-3 py-2 text-sm font-medium">
          {t('frequencyBaseline.introAction')}
        </Link>
        <button type="button" onClick={() => setVisible(false)} className="frequency-baseline-intro__dismiss rounded-lg px-3 py-2 text-sm">
          {t('frequencyBaseline.introDismiss')}
        </button>
      </div>
    </section>
  );
}
