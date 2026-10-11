import {Composition,registerRoot} from 'remotion';
import {RevisedVideo} from './RevisedVideo';
import {videoFrames} from './video-revision.mjs';
import '../generated/video-revision.css';
function RevisedRoot(){return <>{[false,true].map(portrait=><Composition key={String(portrait)} id={portrait?'RevisedVertical':'RevisedHorizontal'} component={RevisedVideo} durationInFrames={videoFrames(portrait)} fps={30} width={portrait?1080:1920} height={portrait?1920:1080} defaultProps={{portrait,subtitles:true}}/>)}</>;}
registerRoot(RevisedRoot);
