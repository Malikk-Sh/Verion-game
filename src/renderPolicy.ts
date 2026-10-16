/** Only presentation is throttled. Fixed simulation and UI continue on every RAF. */
export function sceneInterval(started:boolean,running:boolean,dialog:string,quality:string){
 if(!started)return 1000/30;
 if(!running)return 250;
 // S4: the full-screen map covers the scene; its own overlay redraws on interaction and at ~4 Hz.
 if(dialog==='map-panel')return 250;
 if(dialog)return quality==='low'?100:1000/15;
 return quality==='low'?1000/30:0;
}
