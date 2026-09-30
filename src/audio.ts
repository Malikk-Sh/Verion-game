/**
 * Procedural ambience (no audio files): outdoor wind with gusts, muffled hum inside the
 * capsule, soft footsteps and short interface tones. Starts only after a user gesture.
 */
export class Ambience {
 private ctx:AudioContext|null=null; private master!:GainNode; private windGain!:GainNode; private windFilter!:BiquadFilterNode; private whistle!:GainNode; private hum!:GainNode; private noise!:AudioBuffer;
 enabled=true; private gustPhase=Math.random()*10;
 start(){
  if(this.ctx){void this.ctx.resume();return;}
  const Ctx=window.AudioContext||(window as unknown as {webkitAudioContext:typeof AudioContext}).webkitAudioContext;if(!Ctx)return;
  const ctx=this.ctx=new Ctx();this.master=ctx.createGain();this.master.gain.value=this.enabled?.8:0;this.master.connect(ctx.destination);
  const len=ctx.sampleRate*4,buf=this.noise=ctx.createBuffer(1,len,ctx.sampleRate),d=buf.getChannelData(0);let last=0;
  for(let i=0;i<len;i++){const w=Math.random()*2-1;last=(last+.02*w)/1.02;d[i]=last*3.5;}
  const src=ctx.createBufferSource();src.buffer=buf;src.loop=true;
  this.windFilter=ctx.createBiquadFilter();this.windFilter.type='lowpass';this.windFilter.frequency.value=420;this.windFilter.Q.value=.6;
  this.windGain=ctx.createGain();this.windGain.gain.value=.0;src.connect(this.windFilter).connect(this.windGain).connect(this.master);
  const src2=ctx.createBufferSource();src2.buffer=buf;src2.loop=true;src2.playbackRate.value=1.7;
  const band=ctx.createBiquadFilter();band.type='bandpass';band.frequency.value=900;band.Q.value=9;this.whistle=ctx.createGain();this.whistle.gain.value=0;src2.connect(band).connect(this.whistle).connect(this.master);
  this.hum=ctx.createGain();this.hum.gain.value=0;const lp=ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=260;
  for(const [f,g] of [[55,.5],[110,.25],[164.8,.08]]){const o=ctx.createOscillator();o.frequency.value=f;const og=ctx.createGain();og.gain.value=g;o.connect(og).connect(lp);o.start();}
  lp.connect(this.hum).connect(this.master);src.start();src2.start(0,1.3);
 }
 setEnabled(on:boolean){this.enabled=on;if(this.ctx)this.master.gain.setTargetAtTime(on?.8:0,this.ctx.currentTime,.1);}
 suspend(){void this.ctx?.suspend();}
 resume(){if(this.ctx&&this.enabled)void this.ctx.resume();}
 /** inside: 0..1 how enclosed the listener is; night lowers the wind a little. */
 update(dt:number,inside:number,night:number){
  const c=this.ctx;if(!c)return;this.gustPhase+=dt;
  const gust=.55+.45*Math.sin(this.gustPhase*.23)*Math.sin(this.gustPhase*.071+1.3);
  const t=c.currentTime,out=1-inside;
  this.windGain.gain.setTargetAtTime((.1+.16*gust)*(.25+.75*out)*(1-night*.25),t,.3);
  this.windFilter.frequency.setTargetAtTime(inside>.5?180:280+gust*520,t,.3);
  this.whistle.gain.setTargetAtTime(Math.max(0,gust-.7)*.05*out,t,.5);
  this.hum.gain.setTargetAtTime(.035*inside+.004,t,.4);
 }
 step(run:boolean,inside:boolean){
  const c=this.ctx;if(!c||!this.enabled)return;const s=c.createBufferSource();s.buffer=this.noise;const f=c.createBiquadFilter();f.type=inside?'bandpass':'lowpass';f.frequency.value=inside?1400:620+Math.random()*260;f.Q.value=inside?2:.7;
  const g=c.createGain(),t=c.currentTime,v=(run?.2:.13)*(inside?.8:1);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+.012);g.gain.exponentialRampToValueAtTime(.001,t+(inside?.09:.16));
  s.connect(f).connect(g).connect(this.master);s.start(t,Math.random()*3,.2);
 }
 tone(kind:'ui'|'scan'|'discover'|'boot'){
  const c=this.ctx;if(!c||!this.enabled)return;const t=c.currentTime;
  const seq:Record<string,[number,number,number][]>={ui:[[880,0,.06]],scan:[[520,0,.09],[780,.08,.09],[1170,.16,.14]],discover:[[660,0,.12],[990,.1,.22]],boot:[[330,0,.12],[495,.12,.12],[660,.24,.2]]};
  for(const [f,d,l] of seq[kind]){const o=c.createOscillator();o.type='sine';o.frequency.value=f;const g=c.createGain();g.gain.setValueAtTime(0,t+d);g.gain.linearRampToValueAtTime(.06,t+d+.01);g.gain.exponentialRampToValueAtTime(.001,t+d+l);o.connect(g).connect(this.master);o.start(t+d);o.stop(t+d+l+.05);}
 }
}
