import { invoke } from '@tauri-apps/api/core';
import { mutateSaved, undoSaved, type SavedMutation, type SavedMutationResult, type SavedRecord } from './savedRecords';
export type ReadingScope = { kind: 'library' } | { kind: 'example'; sessionId: string };
export const LIBRARY_SCOPE: ReadingScope = { kind: 'library' };
type SaveInput = Extract<SavedMutation, {kind:'save'}>['input'];
export function selectionInScope(scope:ReadingScope,input:SaveInput):Promise<SavedRecord|null> {
  return scope.kind==='example'?invoke('example_saved_for_selection',{sessionId:scope.sessionId,input}):invoke('saved_for_selection',{input});
}
export function mutateInScope(scope:ReadingScope,mutation:SavedMutation,operationId:string):Promise<SavedMutationResult> {
  return scope.kind==='example'?invoke('mutate_example_saved_record',{sessionId:scope.sessionId,mutation,operationId}):mutateSaved(mutation,operationId);
}
export function undoInScope(scope:ReadingScope,operationId:string):Promise<SavedRecord> {
  return scope.kind==='example'?invoke('undo_example_saved_mutation',{sessionId:scope.sessionId,operationId}):undoSaved(operationId);
}
