import test from 'node:test';
import assert from 'node:assert/strict';
class Utterance {constructor(text){this.text=text;}}
function browser(){const events=[];globalThis.SpeechSynthesisUtterance=Utterance;globalThis.window={SpeechSynthesisUtterance:Utterance,speechSynthesis:{cancel(){},pause(){},resume(){},getVoices(){return [];},speak(item){events.push(item);}}};return events;}
test('silent browser speech times out to an error and can retry',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const events=browser();
 const {useSpeechStore:store,SPEECH_START_TIMEOUT_MS:timeout}=await import('./speech.ts?test=timeout');
 await store.getState().speak('A quiet morning.','demo:speech');assert.equal(store.getState().status,'loading');
 t.mock.timers.tick(timeout-1);assert.equal(store.getState().status,'loading');t.mock.timers.tick(1);
 assert.equal(store.getState().status,'error');assert.equal(store.getState().loading,false);assert.equal(store.getState().errorKey,'demo:speech');assert.equal(store.getState().errorCode,'browser_speech_start_timeout');
 events[0].onstart();assert.equal(store.getState().status,'error','a late start cannot turn a timed-out operation into playing');
 await store.getState().speak('Try again.','demo:retry');events[1].onstart();assert.equal(store.getState().status,'playing');t.mock.timers.tick(timeout+1);assert.equal(store.getState().status,'playing');events[1].onend();assert.equal(store.getState().status,'idle');
 store.getState().stop();t.mock.timers.reset();
});
test('stop and real browser errors clear the startup watchdog',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const events=browser();const {useSpeechStore:store,SPEECH_START_TIMEOUT_MS:timeout}=await import('./speech.ts?test=stop');
 await store.getState().speak('Cancel me.','demo:cancel');store.getState().stop();t.mock.timers.tick(timeout+1);assert.equal(store.getState().status,'idle');assert.equal(store.getState().error,false);
 await store.getState().speak('Browser error.','demo:error');events[1].onerror();assert.equal(store.getState().errorCode,'browser_speech_failed');t.mock.timers.tick(timeout+1);assert.equal(store.getState().errorCode,'browser_speech_failed');store.getState().stop();t.mock.timers.reset();
});
test('resume after an ended queue submits a real utterance and waits for onstart',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const events=browser();const {useSpeechStore:store}=await import('./speech.ts?test=ended');
 await store.getState().startQueue([{text:'One real sentence.',key:'reader:demo:0'}]);events[0].onstart();assert.equal(store.getState().status,'playing');events[0].onend();assert.equal(store.getState().status,'idle');assert.equal(store.getState().reading.status,'ended');
 await store.getState().resume();assert.equal(events.length,2);assert.equal(store.getState().status,'loading');assert.equal(store.getState().reading.status,'loading');events[1].onstart();assert.equal(store.getState().status,'playing');assert.equal(store.getState().reading.status,'playing');store.getState().stop();t.mock.timers.reset();
});
test('paused playback waits for a real resume event and resumes with a bounded timeout',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const events=browser();const {useSpeechStore:store,SPEECH_START_TIMEOUT_MS:timeout}=await import('./speech.ts?test=resume');
 await store.getState().startQueue([{text:'Pause then resume.',key:'reader:demo:0'}]);events[0].onstart();store.getState().pause();events[0].onpause();assert.equal(store.getState().status,'paused');
 await store.getState().resume();assert.equal(events.length,1,'a still-paused utterance uses actual resume');assert.equal(store.getState().status,'loading');events[0].onresume();assert.equal(store.getState().status,'playing');t.mock.timers.tick(timeout+1);assert.equal(store.getState().status,'playing');
 store.getState().pause();events[0].onpause();await store.getState().resume();assert.equal(store.getState().status,'loading');t.mock.timers.tick(timeout);assert.equal(store.getState().status,'error');assert.equal(store.getState().errorCode,'browser_speech_resume_timeout');assert.equal(store.getState().reading.status,'error');events[0].onresume();assert.equal(store.getState().status,'error','late resume cannot resurrect a failed request');
 await store.getState().resume();assert.equal(events.length,2,'failed playback requires a fresh utterance');assert.equal(store.getState().status,'loading');events[1].onstart();assert.equal(store.getState().status,'playing');store.getState().stop();t.mock.timers.reset();
});
test('real speech preferences map accent and slow speed onto the submitted utterance',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const events=browser();
 const {useSpeechStore:store,configureBrowserSpeechPreferences:configure}=await import('./speech.ts?test=preferences');
 let preferences={accent:'gb',speed:'slow'};configure(()=>preferences);
 store.getState().setRate(1.25);await store.getState().speak('British slow preview.','preview');assert.equal(events[0].lang,'en-GB');assert.equal(events[0].rate,1);assert.equal(store.getState().status,'loading');events[0].onstart();assert.equal(store.getState().status,'playing');
 store.getState().stop();preferences={accent:'us',speed:'normal'};store.getState().setRate(.75);await store.getState().speak('American preview.','preview-us');assert.equal(events[1].lang,'en-US');assert.equal(events[1].rate,.75);events[1].onstart();assert.equal(store.getState().status,'playing');store.getState().stop();t.mock.timers.reset();
});
