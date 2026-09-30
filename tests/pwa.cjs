const assert=require('assert/strict'),fs=require('fs'),vm=require('vm');
const listeners={},removed=[],stored=[];let skipped=false,claimed=false,offline=false;
const context={URL,location:{origin:'https://caisse.test'},self:{addEventListener:(type,fn)=>listeners[type]=fn,skipWaiting:async()=>{skipped=true},clients:{claim:async()=>{claimed=true}}},caches:{open:async()=>({addAll:async urls=>stored.push(...urls)}),keys:async()=>['assistant-caisse-shell-v3','assistant-caisse-shell-v4','unrelated-cache'],delete:async key=>removed.push(key),match:async request=>'cached:'+request},fetch:async request=>{if(offline)throw Error('offline');return 'fresh:'+request.url}};
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../static/sw.js'),'utf8'),context);
(async()=>{
 let waiting;listeners.install({waitUntil:p=>waiting=p});await waiting;assert(skipped);assert(!stored.some(u=>u.startsWith('/api')));
 listeners.activate({waitUntil:p=>waiting=p});await waiting;assert(claimed);assert.deepEqual(removed,['assistant-caisse-shell-v3']);
 const request=(path,mode='cors',method='GET')=>{let response;listeners.fetch({request:{url:'https://caisse.test'+path,method,mode},respondWith:p=>response=p});return response;};
 assert.equal(request('/api/catalog'),undefined);assert.equal(request('/api/admin/products'),undefined);assert.equal(request('/api/search','cors','POST'),undefined);
 assert.equal(await request('/','navigate'),'fresh:https://caisse.test/');offline=true;
 assert.equal(await request('/','navigate'),'cached:/static/offline.html');assert.equal(await request('/admin','navigate'),'cached:/static/offline.html');
 console.log('PWA: activation, obsolete shell removal, API exclusion, network-first navigation and offline fallback passed. No installation on a physical iPad tested.');
})().catch(e=>{console.error(e);process.exitCode=1});

// Client update lifecycle, simulated browser; no claim of native iPad installation.
async function clientUpdate(){
 const {JSDOM,VirtualConsole}=require('jsdom'),root=require('path').resolve(__dirname,'..');
 let changed,reloads=0;const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(e.message.includes('navigation'))reloads++;else throw e});
 const dom=new JSDOM(fs.readFileSync(root+'/templates/index.html','utf8'),{url:'https://caisse.test',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
 w.AbortController=AbortController;Object.defineProperty(w,'isSecureContext',{value:true});
 w.SpeechRecognition=class{constructor(){w.rec=this}start(){this.onstart?.()}abort(){this.onend?.()}};
 Object.defineProperty(w.navigator,'serviceWorker',{value:{controller:{},addEventListener:(name,fn)=>{if(name==='controllerchange')changed=fn},register:async()=>({update:async()=>{}})}});
 w.fetch=async url=>({ok:true,json:async()=>url==='/api/session'?{kiosk_required:false}:{products:[],revision:'r'}});
 try{
  w.eval(fs.readFileSync(root+'/static/app.js','utf8'));await new Promise(r=>setTimeout(r,20));
  w.document.querySelector('#query').value='banane plantain';w.document.querySelector('#mic').click();changed();assert.equal(reloads,0);
  w.document.querySelector('#mic').click();await new Promise(r=>setTimeout(r,1100));
  assert.equal(reloads,1);assert.equal(w.sessionStorage.getItem('caisse-update-query'),'banane plantain');changed();assert.equal(reloads,1);
  console.log('PWA client: mise à jour attend la fin du micro, conserve le texte et ne recharge qu’une fois (simulation).');
 }finally{w.close()}
}
clientUpdate().catch(e=>{console.error(e);process.exitCode=1});
