import { compileRecall, type RecallSegment } from './recallMatcher';
let matcher = compileRecall([]), version = -1;
self.onmessage = (event: MessageEvent<
  { type: 'index'; version: number; expressions: string[] } |
  { type: 'match'; version: number; request: number; segments: RecallSegment[] }
>) => {
  const input = event.data;
  try {
    if (input.type === 'index') {
      matcher = compileRecall(input.expressions); version = input.version;
    } else {
      if (version !== input.version) throw Error('recall_index_changed');
      self.postMessage({ request: input.request, version, matches: input.segments.map(segment => ({ index: segment.index, matches: matcher.match(segment.text) })) });
    }
  } catch {
    self.postMessage({ request: input.type === 'match' ? input.request : null, version: input.version, error: true });
  }
};
