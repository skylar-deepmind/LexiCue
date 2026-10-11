"""Deterministic original UI sounds mixed with the attributed CC BY 4.0 track."""
import wave,math,array,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parents[1]
out=root.parent/'output'/'marketing';out.mkdir(parents=True,exist_ok=True)
for name,duration,cues in [('horizontal-90s',90,[6,8,16,20,31,35,46,52,58,63,70,74,77,80,83,86]),('vertical-30s',30,[3,5,6,8,10,13,17,20,23,24,26,27])]:
 rate=48000;data=array.array('h',[0])*(rate*duration)
 for t in cues:
  for n in range(int(rate*.16)):
   x=n/rate;env=min(1,x/.006)*math.exp(-x*35)
   value=int(1700*env*(math.sin(2*math.pi*740*x)+.3*math.sin(2*math.pi*1480*x)))
   data[int(t*rate)+n]=value
 path=out/(name+'-sfx.wav')
 with wave.open(str(path),'w') as w:w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate);w.writeframes(data.tobytes())
 subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(root/'public/audio/carefree.mp3'),'-i',str(path),'-filter_complex',f'[0:a]atrim=0:{duration},asetpts=PTS-STARTPTS,volume=0.28,afade=t=in:d=1.3,afade=t=out:st={duration-2}:d=2[m];[m][1:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.8,loudnorm=I=-20:TP=-1.5:LRA=7[a]','-map','[a]','-ar','48000','-ac','2',str(out/(name+'-audio.wav'))],check=True)
