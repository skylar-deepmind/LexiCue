import {manualContent} from './manual-content.mjs';
export const manualCopy=Object.fromEntries(Object.entries(manualContent).map(([locale,chapters])=>[locale,{descriptions:Object.fromEntries(Object.entries(chapters).map(([id,chapter])=>[id,chapter.intro]))}]));
