/** Browser chrome can only be hidden by a user gesture and a supported Fullscreen API. */
export function installFullscreen(button:HTMLButtonElement,status:HTMLElement){
 const label=button.querySelector('[data-fullscreen-label]')!;
 const supported=typeof document.documentElement.requestFullscreen==='function'&&document.fullscreenEnabled!==false;
 const sync=()=>{
  const active=!!document.fullscreenElement;
  label.textContent=active?'Выйти из полного экрана':'На весь экран';
  button.setAttribute('aria-pressed',String(active));
 };
 if(!supported){button.disabled=true;status.textContent='Этот браузер не поддерживает полный экран. На телефоне можно открыть игру с главного экрана, если браузер предлагает эту возможность.';}
 button.addEventListener('click',async()=>{
  status.textContent='';
  try {
   if(document.fullscreenElement)await document.exitFullscreen();
   else await document.documentElement.requestFullscreen({navigationUI:'hide'});
   status.textContent=document.fullscreenElement?'Полноэкранный режим включён.':'Полноэкранный режим выключен.';
  }catch{status.textContent='Браузер не разрешил полный экран. Попробуйте открыть игру в отдельной вкладке и нажать ещё раз.';}
  sync();
 });
 document.addEventListener('fullscreenchange',sync);sync();
}
