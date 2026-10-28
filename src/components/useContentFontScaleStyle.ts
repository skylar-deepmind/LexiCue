import { contentFontScaleStyle } from '../lib/contentFontScale';
import { usePreferencesStore } from '../stores/preferencesStore';

/** Apply to the reading surface and its portalled definition panel. */
export default function useContentFontScaleStyle() {
  return contentFontScaleStyle(usePreferencesStore(state => state.contentFontScale));
}
