/* Playback logger compatibility bootstrap + profile-isolated runtimes. */
(()=>{
  'use strict';
  if(window.__journeyPlaybackBootstrapInstalled)return;
  window.__journeyPlaybackBootstrapInstalled=true;
  if(document.readyState==='loading'){
    document.write('<script src="/mountain-axis-fix.js?v=0.1.0"><\/script><script src="/playback-log-core.js?v=0.1.54"><\/script>');
    return;
  }
  const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.async=false;s.onload=resolve;s.onerror=reject;document.head.appendChild(s)});
  load('/mountain-axis-fix.js?v=0.1.0').finally(()=>load('/playback-log-core.js?v=0.1.54'));
})();