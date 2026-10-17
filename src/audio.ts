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
 update(dt:number,inside:number,night:number,sharedGust?:number){
  const c=this.ctx;if(!c)return;this.gustPhase+=dt;
  // S4: the shared world wind (wind.ts) drives the gusts when given, so sound, grass and dust agree.
  const gust=sharedGust??.55+.45*Math.sin(this.gustPhase*.23)*Math.sin(this.gustPhase*.071+1.3);
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
 // ---------- S4 mining: per-material strikes, the break and the collapse (short-lived nodes, collected after stop) ----------
 /** Output for one voice: panned (±1 → hit side) when the browser has a stereo panner. */
 private out(pan:number):AudioNode{const c=this.ctx!;if(!pan||!c.createStereoPanner)return this.master;const p=c.createStereoPanner();p.pan.value=Math.max(-1,Math.min(1,pan));p.connect(this.master);return p;}
 private burst(type:BiquadFilterType,freq:number,q:number,gain:number,dur:number,to:AudioNode,at=0){
  const c=this.ctx!,s=c.createBufferSource();s.buffer=this.noise;const f=c.createBiquadFilter();f.type=type;f.frequency.value=freq;f.Q.value=q;
  const g=c.createGain(),t=c.currentTime+at;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(gain,t+.004);g.gain.exponentialRampToValueAtTime(.001,t+dur);
  s.connect(f).connect(g).connect(to);s.start(t,Math.random()*3,dur+.05);
 }
 private ring(type:OscillatorType,freq:number,gain:number,dur:number,to:AudioNode,at=0,end?:number){
  const c=this.ctx!,o=c.createOscillator(),t=c.currentTime+at;o.type=type;o.frequency.setValueAtTime(freq,t);if(end)o.frequency.exponentialRampToValueAtTime(end,t+dur);
  const g=c.createGain();g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(gain,t+.003);g.gain.exponentialRampToValueAtTime(.001,t+dur);o.connect(g).connect(to);o.start(t);o.stop(t+dur+.05);
 }
 /** Tool strike: stone knock, metal ring (iron brighter than copper), glassy ice, sand crunch, grass rustle.
  *  ±6% random detune, up to +12% pitch as the block nears its break; `pan` −1…1 is the hit side. */
 strike(material:string,progress=0,pan=0){
  const c=this.ctx;if(!c||!this.enabled)return;const k=(1+(Math.random()*2-1)*.06)*(1+.12*Math.max(0,Math.min(1,progress))),o=this.out(pan*.15);
  switch(material){
   case 'iron':case 'copper':{const cu=material==='copper',a=cu?1700:2100,b=cu?2800:3400;this.burst('bandpass',a*k,4,.26,.06,o);this.ring('triangle',a*k,.07,.15,o);this.ring('triangle',b*k*1.01,.045,.12,o);break;}
   case 'ice':this.burst('bandpass',2600*k,6,.28,.11,o);this.ring('sine',4200*k,.05,.14,o);break;
   case 'sand':this.burst('lowpass',500*k,.8,.3,.14,o);break;
   case 'grass':this.burst('bandpass',3000*k,1.4,.12,.1,o);break;
   default:this.burst('bandpass',1200*k,3,.32,.09,o);
  }
 }
 /** A block breaks off: low crack and thump (a soft tear for grass). */
 crack(material:string,pan=0){
  const c=this.ctx;if(!c||!this.enabled)return;const o=this.out(pan*.15);
  if(material==='grass'){this.burst('bandpass',1800,1,.14,.16,o);return;}
  this.burst('lowpass',material==='sand'?220:300,.9,.34,.25,o);this.ring('sine',material==='ice'?140:90,.22,.12,o,0,material==='ice'?90:55);
  if(material==='ice')this.ring('sine',3100,.04,.3,o,.02);
 }
 /** The deposit is exhausted and collapses: a longer rumble and a falling two-note figure. */
 crumble(){
  const c=this.ctx;if(!c||!this.enabled)return;this.burst('lowpass',200,.7,.38,.75,this.master);this.burst('lowpass',150,.7,.26,.6,this.master,.14);
  this.ring('sine',520,.05,.18,this.master,.08);this.ring('sine',390,.05,.28,this.master,.24);
 }
 /** Air escaping a breached room: 2 s of high band-passed noise that fades out. */
 hiss(){
  const c=this.ctx;if(!c||!this.enabled)return;const s=c.createBufferSource();s.buffer=this.noise;const f=c.createBiquadFilter();f.type='highpass';f.frequency.value=2400;f.Q.value=.8;
  const g=c.createGain(),t=c.currentTime;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.22,t+.03);g.gain.exponentialRampToValueAtTime(.001,t+2);
  s.connect(f).connect(g).connect(this.master);s.start(t,Math.random()*1.5,2.05);
 }
 /** Airlock (D36): 'hiss' — 3 s of gas filling or leaving the chamber (softer and lower than a breach), 'slide' — the
  *  leaves' motor whir with a latch at the end, 'clunk' — a heavy metal thud as a door seals. */
 airlock(kind:'hiss'|'slide'|'clunk'){
  const c=this.ctx;if(!c||!this.enabled)return;
  if(kind==='hiss'){const s=c.createBufferSource();s.buffer=this.noise;const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=1700;f.Q.value=.7;
   const g=c.createGain(),t=c.currentTime;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(.12,t+.15);g.gain.setValueAtTime(.12,t+2.4);g.gain.exponentialRampToValueAtTime(.001,t+3);
   s.connect(f).connect(g).connect(this.master);s.start(t,Math.random()*.9,3.05);this.ring('sine',95,.12,.18,this.master);return;}
  if(kind==='slide'){this.ring('sawtooth',70,.035,.75,this.master,0,110);this.burst('bandpass',900,2,.05,.7,this.master);this.ring('sine',180,.08,.09,this.master,.72);this.burst('lowpass',260,.9,.16,.12,this.master,.72);return;}
  this.burst('lowpass',180,.8,.36,.22,this.master);this.ring('sine',70,.26,.2,this.master,0,45);this.ring('triangle',620,.04,.12,this.master,.01);
 }
 /** Interface tones; `at` delays (s) and `level` scales one (the mined-item chime follows the crack quieter). */
 tone(kind:'ui'|'scan'|'discover'|'boot'|'item'|'warn',at=0,level=1){
  const c=this.ctx;if(!c||!this.enabled)return;const t=c.currentTime+at;
  const seq:Record<string,[number,number,number][]>={ui:[[880,0,.06]],scan:[[520,0,.09],[780,.08,.09],[1170,.16,.14]],discover:[[660,0,.12],[990,.1,.22]],boot:[[330,0,.12],[495,.12,.12],[660,.24,.2]],item:[[740,0,.07],[1110,.06,.1]],warn:[[300,0,.14],[220,.14,.2]]};
  for(const [f,d,l] of seq[kind]){const o=c.createOscillator();o.type='sine';o.frequency.value=f;const g=c.createGain();g.gain.setValueAtTime(0,t+d);g.gain.linearRampToValueAtTime(.06*level,t+d+.01);g.gain.exponentialRampToValueAtTime(.001,t+d+l);o.connect(g).connect(this.master);o.start(t+d);o.stop(t+d+l+.05);}
 }
}
