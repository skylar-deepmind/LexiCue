import {afterEach,expect,it,vi} from 'vitest';
const invoke=vi.hoisted(()=>vi.fn());
vi.mock('@tauri-apps/api/core',()=>({invoke}));
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();vi.clearAllMocks();});
it('does not schedule or upload even when a retained manual caller forces sync',async()=>{
  vi.stubEnv('VITE_SLICE_PREVIEW','0');
  const {syncCoordinator}=await import('../syncCoordinator');
  const stop=syncCoordinator.start();
  syncCoordinator.markChanged();await syncCoordinator.runNow();await syncCoordinator.runNow(true);stop();
  expect(invoke).not.toHaveBeenCalled();
});
