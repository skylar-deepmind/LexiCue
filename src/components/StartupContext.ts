import { createContext, useContext } from 'react';

export const StartupContext=createContext(false);
export const useAppStarting=()=>useContext(StartupContext);
