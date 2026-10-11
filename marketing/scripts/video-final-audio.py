"""Original soft click sounds aligned to the approved revised frame timeline."""
import array,json,math,pathlib,subprocess,sys,wave
spec=json.loads(pathlib.Path(sys.argv[1]).read_text());duration=spec['duration'];rate=48000
data=array.array('h',[0])*round(rate*duration)
for t in spec['cues']:
 for n in range(round(rate*.12)):
  x=n/rate;env=min(1,x/.005)*math.exp(-x*42)
  value=round(1150*env*(math.sin(2*math.pi*740*x)+.22*math.sin(2*math.pi*1480*x)))
  at=round(t*rate)+n
  if at<len(data):data[at]=max(-32768,min(32767,data[at]+value))
out=pathlib.Path(spec['out']);clicks=out.with_name(out.stem+'-clicks.wav')
with wave.open(str(clicks),'w') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes(data.tobytes())
music=pathlib.Path(__file__).resolve().parents[1]/'public/audio/carefree.mp3'
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-i',str(music),'-i',str(clicks),'-filter_complex',f'[0:a]atrim=0:{duration},asetpts=PTS-STARTPTS,volume=0.28,afade=t=in:d=1,afade=t=out:st={duration-2}:d=2[m];[m][1:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.8,loudnorm=I=-20:TP=-1.5:LRA=7[a]','-map','[a]','-ar',str(rate),'-ac','2',str(out)],check=True)
