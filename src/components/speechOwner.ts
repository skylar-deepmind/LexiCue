import { createContext } from 'react';

/** A card can release its own audio without touching a reading session. */
export const SpeechOwnerContext = createContext<string | null>(null);
