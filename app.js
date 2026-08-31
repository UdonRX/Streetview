function boot(){
  initMap();resetPlanner();if(!token())openTokenSheet();
  $('resetRoute').addEventListener('click',resetPlanner);$('openViewer').addEventListener('click',openViewer);$('backToPlanner').addEventListener('click',backToPlanner);$('start').addEventListener('click',playback);$('stop').addEventListener('click',()=>stopPlayback('user-stop'));$('toggleDiag').addEventListener('click',()=>{$('diag').classList.toggle('is-open');renderDiagnostics()});$('copyDiag').addEventListener('click',copyDiagnostics);$('speed').addEventListener('input',()=>{$('speedOut').value=`${(Number($('speed').value)/1000).toFixed(2)}s`});$('tokenSettings').addEventListener('click',openTokenSheet);$('saveToken').addEventListener('click',saveToken);$('cancelToken').addEventListener('click',()=>{$('tokenSheet').hidden=true});addEventListener('pagehide',()=>{state.preloadGeneration++;destroyViewer()},{once:true});renderDiagnostics()
}
boot();
