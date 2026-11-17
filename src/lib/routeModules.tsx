import { useEffect, useState, type ComponentType } from 'react';
import { RouteLoading } from '../components/LoadingFeedback';

function routeModule(load: () => Promise<{ default: ComponentType }>) {
  type Result = { Page: ComponentType } | { error: unknown };
  let pending: Promise<Result> | undefined;
  let result: Result | undefined;
  const loadOnce = () => pending ??= load().then(
    module => result = { Page: module.default },
    error => result = { error },
  );
  function Route() {
    const [loaded, setLoaded] = useState(result);
    useEffect(() => {
      if (loaded) return;
      let active = true;
      void loadOnce().then(next => { if (active) setLoaded(next); });
      return () => { active = false; };
    }, [loaded]);
    if (!loaded) return <RouteLoading/>;
    if ('error' in loaded) throw loaded.error;
    return <loaded.Page/>;
  }
  return { preload: () => { void loadOnce(); }, Page: Route };
}

export const readingRoute = routeModule(() => import('../pages/FileDetailPage'));
export const savedRoute = routeModule(() => import('../pages/SavedArchivePage'));
export const settingsRoute = routeModule(() => import('../pages/SettingsPage'));
