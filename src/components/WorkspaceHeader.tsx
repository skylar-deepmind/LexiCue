import { isTauri } from '@tauri-apps/api/core';

/** Native windows have an OS titlebar; browsers get a neutral placeholder. */
export default function WorkspaceHeader() {
    return isTauri() ? null : <header className="b-header"><span className="workspace-title">LexiCue</span></header>;
}
