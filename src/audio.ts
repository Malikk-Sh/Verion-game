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
 // ---------- S5.1 airlock and landing: layered voices, a shared metal-room reverb, distance and side ----------
 private verb:ConvolverNode|null=null;
 /** A short procedural impulse (dense noise, exponential 0.7 s tail, slightly brighter early part): the steel chamber. */
 private reverb(){
  const c=this.ctx!;if(this.verb)return this.verb;const n=Math.floor(c.sampleRate*.9),ir=c.createBuffer(2,n,c.sampleRate);
  for(let ch=0;ch<2;ch++){const d=ir.getChannelData(ch);for(let i=0;i<n;i++){const t=i/c.sampleRate;d[i]=(Math.random()*2-1)*Math.exp(-t/.16)*(t<.012?.4:1);}}
  const v=this.verb=c.createConvolver();v.buffer=ir;const wet=c.createGain();wet.gain.value=.32;v.connect(wet).connect(this.master);return v;
 }
 /** One voice bus: level, side (pan) and a send to the chamber reverb. */
 private bus(level:number,pan:number,wet:number){const c=this.ctx!,g=c.createGain();g.gain.value=level;g.connect(this.out(pan));if(wet>0){const s=c.createGain();s.gain.value=wet;g.connect(s).connect(this.reverb());}return g;}
 /** Filtered noise with a gain envelope [[time, gain]…] and an optional filter-frequency path [[time, Hz]…]. */
 private flow(type:BiquadFilterType,q:number,env:[number,number][],freq:[number,number][],to:AudioNode,rate=1){
  const c=this.ctx!,t=c.currentTime,s=c.createBufferSource();s.buffer=this.noise;s.loop=true;s.playbackRate.value=rate;const f=c.createBiquadFilter();f.type=type;f.Q.value=q;
  f.frequency.setValueAtTime(freq[0][1],t);for(const [at,hz] of freq.slice(1))f.frequency.exponentialRampToValueAtTime(hz,t+at);
  const g=c.createGain();g.gain.setValueAtTime(0,t);for(const [at,v] of env)g.gain.linearRampToValueAtTime(v,t+at);
  const end=env[env.length-1][0];s.connect(f).connect(g).connect(to);s.start(t,Math.random()*3);s.stop(t+end+.05);return g;
 }
 /** An oscillator with a pitch path and a gain envelope (both [[time, value]…]). */
 private voice(type:OscillatorType,pitch:[number,number][],env:[number,number][],to:AudioNode,at=0){
  const c=this.ctx!,t=c.currentTime+at,o=c.createOscillator();o.type=type;o.frequency.setValueAtTime(pitch[0][1],t);for(const [a,hz] of pitch.slice(1))o.frequency.exponentialRampToValueAtTime(hz,t+a);
  const g=c.createGain();g.gain.setValueAtTime(0,t);for(const [a,v] of env)g.gain.linearRampToValueAtTime(v,t+a);o.connect(g).connect(to);o.start(t);o.stop(t+env[env.length-1][0]+.05);return {o,g};
 }
 /** Tremolo on a gain (turbulence, roller rumble): an LFO of `hz` and `depth` for `dur` s. */
 private wobble(target:AudioParam,hz:number,depth:number,dur:number){const c=this.ctx!,l=c.createOscillator(),d=c.createGain(),t=c.currentTime;l.frequency.value=hz;d.gain.value=depth;l.connect(d).connect(target);l.start(t);l.stop(t+dur);}
 /** Heavy metal impact: a falling sub thud, a dull body, inharmonic steel partials ringing out and a gravel-free click. */
 private impact(to:AudioNode,weight:number,at=0){
  this.voice('sine',[[0,72],[.3,38]],[[.004,.42*weight],[.36,0]],to,at);
  this.burst('lowpass',240,.8,.3*weight,.22,to,at);this.burst('bandpass',2600,1.4,.08*weight,.035,to,at);
  [233,377,611,912,1387].forEach((hz,i)=>this.voice('triangle',[[0,hz*(1+(Math.random()-.5)*.01)]],[[.006,.035*weight/(1+i*.5)],[.5+.25*i,0]],to,at));
 }
 /**
  * Airlock (D36, S5.1 sound). 'fill': the valve clicks open, gas rushes in with a rising pitch and turbulence and settles
  * as the pressure evens out (3 s); 'vent': a decompression whoosh that falls away outside; 'slide': the leaf drive —
  * servo hum, gear whine and roller rumble — ending in the latch; 'clunk': the door seals (heavy impact, steel ring,
  * a short pneumatic sigh). `level` 0…1 (distance), `pan` −1…1 (side). All with the chamber's reverb.
  */
 airlock(kind:'fill'|'vent'|'slide'|'clunk',level=1,pan=0){
  const c=this.ctx;if(!c||!this.enabled||level<=.01)return;const o=this.bus(.9*level,pan*.6,.35);
  if(kind==='fill'||kind==='vent'){
   const fill=kind==='fill';
   this.burst('lowpass',320,.9,.22,.09,o);this.voice('sine',[[0,150],[.12,90]],[[.004,.16],[.14,0]],o);this.burst('highpass',3200,.8,.05,.04,o,.01);
   const main=this.flow('bandpass',.9,fill?[[.25,.16],[2.3,.15],[3,0]]:[[.06,.24],[.6,.17],[2.4,.08],[3,0]],fill?[[0,520],[2.4,1700],[3,2200]]:[[0,2200],[2.6,480],[3,360]],o);
   this.wobble(main.gain,fill?9:6,.035,3);
   const fizz=this.flow('highpass',.7,fill?[[.3,.035],[2.4,.03],[3,0]]:[[.05,.06],[1.6,.03],[3,0]],[[0,fill?4200:5200],[3,fill?5600:3600]],o,1.6);this.wobble(fizz.gain,13,.015,3);
   this.flow('lowpass',.7,fill?[[.4,.08],[2.5,.06],[3,0]]:[[.08,.14],[1,.07],[3,0]],[[0,fill?140:220],[3,fill?190:110]],o);
   this.burst('lowpass',260,.9,.12,.08,o,3);this.voice('sine',[[0,110],[.1,70]],[[.004,.08],[.12,0]],o,3);
   return;
  }
  if(kind==='slide'){
   this.voice('sawtooth',[[0,52],[.25,78],[.7,74],[.8,60]],[[.05,.05],[.72,.045],[.82,0]],o);this.voice('square',[[0,104.5],[.25,156],[.8,120]],[[.05,.012],[.72,.01],[.82,0]],o);
   const whine=this.voice('sine',[[0,380],[.3,620],[.75,600],[.82,420]],[[.08,.025],[.7,.02],[.82,0]],o);this.wobble(whine.o.frequency,7,6,.85);
   const roll=this.flow('bandpass',1.1,[[.05,.1],[.72,.09],[.82,0]],[[0,180],[.8,260]],o);this.wobble(roll.gain,22,.05,.85);
   this.burst('highpass',2800,.9,.09,.03,o,.78);this.voice('triangle',[[0,1850]],[[.004,.035],[.07,0]],o,.78);this.impact(o,.35,.79);
   return;
  }
  this.impact(o,1);this.flow('highpass',.8,[[.06,0],[.1,.07],[.45,0]],[[0,3800],[.45,2400]],o);
 }
 /**
  * S5.1 landing after a jump or a fall: `drop` is the height fallen (m). Boots on regolith (a gravel crunch), a body
  * thud whose weight and depth grow with the drop, the suit's gear rattling from about 1.5 m and a second settling
  * thump from about 3 m. A small hop (< 0.3 m) gives only a soft scuff.
  */
 land(drop:number,inside=false){
  const c=this.ctx;if(!c||!this.enabled)return;const k=Math.max(0,Math.min(1,(drop-.3)/3.7)),o=this.bus(.55+.45*k,0,inside?.25:0);
  this.burst(inside?'bandpass':'lowpass',inside?1300:560+260*(1-k),inside?1.6:.8,.12+.2*k,.12+.14*k,o);
  this.burst('bandpass',2400+800*Math.random(),1.2,.05+.07*k,.06+.05*k,o,.012);
  if(drop<.3)return;
  this.voice('sine',[[0,95-25*k],[.18+.2*k,40-8*k]],[[.004,.16+.34*k],[.2+.25*k,0]],o);
  if(k>.3){this.burst('bandpass',3200,3,.05*k,.08,o,.02);this.voice('triangle',[[0,880]],[[.004,.02*k],[.12,0]],o,.03);this.voice('triangle',[[0,1320]],[[.004,.015*k],[.1,0]],o,.05);}
  if(k>.65){this.burst('lowpass',300,.8,.12*k,.16,o,.11);this.voice('sine',[[0,70],[.15,45]],[[.004,.12*k],[.18,0]],o,.11);}
 }
 /** Interface tones; `at` delays (s) and `level` scales one (the mined-item chime follows the crack quieter). */
 tone(kind:'ui'|'scan'|'discover'|'boot'|'item'|'warn',at=0,level=1){
  const c=this.ctx;if(!c||!this.enabled)return;const t=c.currentTime+at;
  const seq:Record<string,[number,number,number][]>={ui:[[880,0,.06]],scan:[[520,0,.09],[780,.08,.09],[1170,.16,.14]],discover:[[660,0,.12],[990,.1,.22]],boot:[[330,0,.12],[495,.12,.12],[660,.24,.2]],item:[[740,0,.07],[1110,.06,.1]],warn:[[300,0,.14],[220,.14,.2]]};
  for(const [f,d,l] of seq[kind]){const o=c.createOscillator();o.type='sine';o.frequency.value=f;const g=c.createGain();g.gain.setValueAtTime(0,t+d);g.gain.linearRampToValueAtTime(.06*level,t+d+.01);g.gain.exponentialRampToValueAtTime(.001,t+d+l);o.connect(g).connect(this.master);o.start(t+d);o.stop(t+d+l+.05);}
 }
}
