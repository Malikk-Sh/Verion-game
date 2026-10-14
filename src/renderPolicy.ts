/** Only presentation is throttled. Fixed simulation and UI continue on every RAF. */
export function sceneInterval(started:boolean,running:boolean,dialog:string,quality:string){
 if(!started)return 1000/30;
 if(!running)return 250;
 if(dialog)return quality==='low'?100:1000/15;
 return quality==='low'?1000/30:0;
}
