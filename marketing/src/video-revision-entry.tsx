import {Composition,registerRoot} from 'remotion';
import {RevisedVideo} from './RevisedVideo';
import {videoFrames,videoFps} from './video-revision.mjs';
import '../generated/video-revision.css';
function RevisedRoot(){return <>{[false,true].map(portrait=><Composition key={String(portrait)} id={portrait?'RevisedVertical':'RevisedHorizontal'} component={RevisedVideo} durationInFrames={videoFrames(portrait)} fps={videoFps} width={portrait?1080:1920} height={portrait?1920:1080} defaultProps={{portrait,subtitles:true,locale:'zh'}}/>)}</>;}
registerRoot(RevisedRoot);
