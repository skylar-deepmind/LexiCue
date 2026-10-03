import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), handlers: new Map<string,(event: { payload: unknown }) => void>() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));
vi.mock('../feedbackStore', () => ({ useFeedbackStore: { getState: () => ({ show: vi.fn(), dismiss: vi.fn() }) } }));
import { useOllamaStore } from '../ollamaStore';
import { previewPhraseKey } from '../../lib/analysisPreview';

const config = { provider: 'ollama' as const, baseUrl: 'http://localhost:11434', model: 'fixture', apiKey: '' };
const phrase = { segmentIndex: 0, canonical: 'pick up', category: 'phrasal_verb', surface: 'picked up', tokenPositions: [1,3], ranges: [{ start: 2,end: 8 },{ start: 12,end: 14 }] };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: string) => void; const promise = new Promise<T>((yes,no) => { resolve = yes; reject = no; }); return { promise,resolve,reject }; }

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.listen.mockImplementation(async (name, callback) => { mocks.handlers.set(name,callback); return () => {}; });
  useOllamaStore.setState({ progress: {}, previews: {}, diagnostics: {}, retrying: {}, previewFileId: null });
});

describe('analysis lifecycle', () => {
  it('registers listeners before analysis, survives closing and keeps partial results on failure', async () => {
    const request = deferred<{ phrase_count: number; occurrence_count: number }>();
    mocks.invoke.mockImplementation((name) => {
      if (name === 'analyze_file_phrases') { expect(mocks.handlers.has('ollama-analysis-preview')).toBe(true); return request.promise; }
      if (name === 'get_file_segments') return Promise.resolve([{ id: 1,index_num: 0,en_text: 'I picked it up.',zh_text: null }]);
      return Promise.resolve(null);
    });
    const task = useOllamaStore.getState().startAnalysis(1,config,false,{ fileName: 'demo.srt', language: 'en' });
    const result = expect(task).rejects.toBe('REQUEST_FAILED');
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('analyze_file_phrases',expect.anything()));
    const state = useOllamaStore.getState();
    const runId = state.previews[1].runId;
    const event = { payload: { fileId: 1,runId,sequence: 1,segmentIndices: [0],source: 'ai',phrases: [phrase] } };
    mocks.handlers.get('ollama-analysis-preview')!(event);
    expect(useOllamaStore.getState().previews[1].phrases[previewPhraseKey(phrase)]).toEqual(phrase);
    state.closePreview();
    expect(useOllamaStore.getState().previewFileId).toBeNull();
    state.openPreview(1);
    expect(useOllamaStore.getState().previews[1].occurrenceCount).toBe(1);
    request.reject('REQUEST_FAILED');
    await result;
    expect(useOllamaStore.getState().previews[1].status).toBe('error');
    mocks.handlers.get('ollama-analysis-preview')!({ payload: { ...event.payload,sequence: 2,phrases: [{ ...phrase,segmentIndex: 2 }] } });
    expect(useOllamaStore.getState().previews[1].occurrenceCount).toBe(1);
  });

  it('keeps loading failures independent from AI and marks results saved only on success', async () => {
    const request = deferred<{ phrase_count: number; occurrence_count: number }>();
    mocks.invoke.mockImplementation(name => name === 'analyze_file_phrases' ? request.promise : name === 'get_file_segments' ? Promise.reject('read failed') : Promise.resolve(null));
    const task = useOllamaStore.getState().startAnalysis(2,config,true,{ fileName: 'two.srt', language: 'en' });
    await vi.waitFor(() => expect(useOllamaStore.getState().previews[2]?.loadError).toBe('read failed'));
    expect(useOllamaStore.getState().previews[2].status).toBe('processing');
    expect(mocks.invoke).toHaveBeenCalledWith('analyze_file_phrases',expect.objectContaining({ forceRefresh: true,runId: expect.any(String) }));
    request.resolve({ phrase_count: 0,occurrence_count: 0 });
    await task;
    expect(useOllamaStore.getState().previews[2].status).toBe('saved');
  });

  it('isolates concurrent files and cancellation without deleting the preview', async () => {
    const one = deferred<{ phrase_count: number; occurrence_count: number }>();
    const two = deferred<{ phrase_count: number; occurrence_count: number }>();
    mocks.invoke.mockImplementation((name,args) => name === 'analyze_file_phrases' ? (args.fileId === 1 ? one.promise : two.promise) : name === 'get_file_segments' ? Promise.resolve([]) : Promise.resolve(null));
    const first = useOllamaStore.getState().startAnalysis(1,config);
    const second = useOllamaStore.getState().startAnalysis(2,config);
    const cancelled = expect(first).rejects.toBe('ERR_CANCELLED');
    await vi.waitFor(() => expect(useOllamaStore.getState().previews[2]).toBeDefined());
    const runId = useOllamaStore.getState().previews[2].runId;
    mocks.handlers.get('ollama-analysis-preview')!({ payload: { fileId: 2,runId,sequence: 1,segmentIndices: [0],source: 'cache',phrases: [phrase] } });
    expect(useOllamaStore.getState().previews[1].occurrenceCount).toBe(0);
    one.reject('ERR_CANCELLED'); await cancelled;
    expect(useOllamaStore.getState().previews[1].status).toBe('cancelled');
    two.resolve({ phrase_count: 1,occurrence_count: 1 }); await second;
    expect(useOllamaStore.getState().previews[2].status).toBe('saved');
  });
  it('does not let a late diagnostic from a failed run overwrite a resumed run', async () => {
    const one = deferred<{ phrase_count: number; occurrence_count: number }>();
    const two = deferred<{ phrase_count: number; occurrence_count: number }>();
    const oldDiagnostic = deferred<null>();
    let analyses = 0, diagnostics = 0;
    mocks.invoke.mockImplementation(name => {
      if (name === 'analyze_file_phrases') return ++analyses === 1 ? one.promise : two.promise;
      if (name === 'get_analysis_diagnostic') return ++diagnostics === 1 ? oldDiagnostic.promise : Promise.resolve(null);
      return Promise.resolve([]);
    });
    const oldTask = useOllamaStore.getState().startAnalysis(1,config);
    const rejected = expect(oldTask).rejects.toBe('REQUEST_FAILED');
    await vi.waitFor(() => expect(analyses).toBe(1));
    const oldRun = useOllamaStore.getState().previews[1].runId;
    one.reject('REQUEST_FAILED');
    await vi.waitFor(() => expect(useOllamaStore.getState().previews[1].status).toBe('error'));
    const newTask = useOllamaStore.getState().startAnalysis(1,config);
    await vi.waitFor(() => expect(analyses).toBe(2));
    const newRun = useOllamaStore.getState().previews[1].runId;
    expect(newRun).not.toBe(oldRun);
    oldDiagnostic.resolve(null); await rejected;
    expect(useOllamaStore.getState().progress[1].runId).toBe(newRun);
    expect(useOllamaStore.getState().previews[1].status).toBe('processing');
    two.resolve({ phrase_count: 0,occurrence_count: 0 }); await newTask;
  });

  it('keeps non-English progress compatible when the backend omits a run ID', async () => {
    const request = deferred<{ phrase_count: number; occurrence_count: number }>();
    mocks.invoke.mockImplementation(name => name === 'analyze_file_phrases' ? request.promise : Promise.resolve(null));
    const task = useOllamaStore.getState().startAnalysis(3,config,false,{ fileName: 'de.srt',language: 'de' });
    await vi.waitFor(() => expect(useOllamaStore.getState().progress[3]).toBeDefined());
    mocks.handlers.get('ollama-analysis-progress')!({ payload: { fileId: 3,status: 'processing',processedSegments: 1,totalSegments: 3,percent: 33 } });
    expect(useOllamaStore.getState().progress[3].runId).toBeTruthy();
    expect(useOllamaStore.getState().previews[3]).toBeUndefined();
    request.resolve({ phrase_count: 1,occurrence_count: 1 }); await task;
    expect(useOllamaStore.getState().progress[3]).toBeUndefined();
  });

  it('coalesces append events within 50ms and flushes rollback immediately', async () => {
    const request = deferred<{ phrase_count: number; occurrence_count: number }>();
    mocks.invoke.mockImplementation(name => name === 'analyze_file_phrases' ? request.promise : name === 'get_file_segments' ? Promise.resolve([]) : Promise.resolve(null));
    const task = useOllamaStore.getState().startAnalysis(4,config);
    const rejected = expect(task).rejects.toBe('STREAM_INTERRUPTED');
    await vi.waitFor(() => expect(useOllamaStore.getState().previews[4]).toBeDefined());
    const runId = useOllamaStore.getState().previews[4].runId;
    const send = (sequence: number,operation: string,phrases = [] as typeof phrase[]) => mocks.handlers.get('ollama-analysis-preview')!({ payload:{fileId:4,runId,sequence,operation,batchId:'1',attemptId:'a',segmentIndices:[0],source:'ai',phrases} });
    send(1,'begin');send(2,'append',[phrase]);
    expect(useOllamaStore.getState().previews[4].occurrenceCount).toBe(0);
    await new Promise(resolve => setTimeout(resolve,55));
    expect(useOllamaStore.getState().previews[4].occurrenceCount).toBe(1);
    expect(useOllamaStore.getState().previews[4].processed.size).toBe(0);
    send(3,'rollback');
    expect(useOllamaStore.getState().previews[4].occurrenceCount).toBe(0);
    request.reject('STREAM_INTERRUPTED'); await rejected;
    expect(useOllamaStore.getState().previews[4].status).toBe('error');
  });
  it('uses a terminal snapshot to recover an unseen final commit and never fails analysis on a read error', async () => {
    const request = deferred<{ phrase_count: number; occurrence_count: number }>();
    mocks.invoke.mockImplementation((name,args) => {
      if (name === 'analyze_file_phrases') return request.promise;
      if (name === 'get_file_segments') return Promise.resolve([]);
      if (name === 'get_analysis_preview_snapshot') return Promise.resolve({fileId:5,runId:args.runId,sequence:8,segmentIndices:[0],phrases:[phrase]});
      return Promise.resolve(null);
    });
    const task = useOllamaStore.getState().startAnalysis(5,config);
    await vi.waitFor(() => expect(useOllamaStore.getState().previews[5]).toBeDefined());
    request.resolve({phrase_count:1,occurrence_count:1});await task;
    const current = useOllamaStore.getState().previews[5];
    expect(current.status).toBe('saved');expect(current.occurrenceCount).toBe(1);expect(current.processed.size).toBe(1);
    mocks.invoke.mockRejectedValue('snapshot read failed');
    await useOllamaStore.getState().loadPreviewSnapshot(5,current.runId);
    expect(useOllamaStore.getState().previews[5].status).toBe('saved');expect(useOllamaStore.getState().previews[5].snapshotError).toBe('snapshot read failed');
  });

});
