const {JSDOM,VirtualConsole,CookieJar}=require('jsdom');
const fs=require('fs');const assert=require('assert/strict');
const root=require('path').resolve(__dirname,'..');
const password=process.env.UI_ADMIN_PASSWORD;
if(!password)throw new Error('Run python scripts/test_ui.py, which starts an isolated test server.');
const base=process.env.UI_BASE_URL||'http://127.0.0.1:8000';
const errors=[];
async function wait(fn,label){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,40));}throw new Error('Timeout: '+label)}
async function page(path,voice=false){
 const jar=new CookieJar();const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 const dom=await JSDOM.fromURL(base+path,{resources:'usable',runScripts:'dangerously',pretendToBeVisual:true,cookieJar:jar,virtualConsole:vc,beforeParse(w){
  w.fetch=async(url,options={})=>{let cookie=await jar.getCookieString(base);const r=await fetch(new URL(url,base),{...options,headers:{...options.headers,...(cookie?{Cookie:cookie}:{})}});for(const c of r.headers.getSetCookie())await jar.setCookie(c,base);return r;};
  w.AbortController=AbortController;
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')};
  if(voice){Object.defineProperty(w,'isSecureContext',{value:true});w.SpeechRecognition=class {constructor(){w.testSpeech=this}start(){this.onstart?.()}stop(){this.onend?.()}abort(){this.onend?.()}}}
 }});await wait(()=>dom.window.document.readyState==='complete','scripts loaded');return dom;
}
function set(dom,id,value){let e=dom.window.document.querySelector(id);e.value=value;e.dispatchEvent(new dom.window.Event('input',{bubbles:true}));}
function submit(dom,id){dom.window.document.querySelector(id).dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));}
(async()=>{
 const cashier=await page('/');const d=cashier.window.document;
 await wait(()=>d.querySelectorAll('.product').length===9,'catalogue accueil');
 assert.equal(d.querySelector('#mic').disabled,true);
 set(cashier,'#query','avocat');await wait(()=>d.querySelectorAll('.product').length===1,'avocat');assert.equal(d.querySelector('.plu').textContent,'D001');
 set(cashier,'#query','pomme');await wait(()=>d.querySelectorAll('.product').length>=3,'pommes');
 set(cashier,'#query','Comment je fais un remboursement sans facture?');await wait(()=>d.querySelector('.answer'),'procedure');assert(d.querySelector('.answer-text').textContent.includes('EXEMPLE DEMO'));
 set(cashier,'#query','mot de passe du coffre');await wait(()=>d.querySelector('.empty'),'inconnu');assert(d.querySelector('.empty').textContent.includes('Demande au superviseur'));
 const admin=await page('/admin'),a=admin.window.document;
 await wait(()=>a.querySelector('#login-form'),'login');set(admin,'#admin-password',password);submit(admin,'#login-form');
 await wait(()=>a.querySelectorAll('[data-edit]').length===26,'admin liste');
 a.querySelector('#add-item').click();set(admin,'#f-name','Produit UI test');set(admin,'#f-code','UI001');set(admin,'#f-keywords','flamboyant');submit(admin,'#edit-form');
 await wait(()=>a.querySelectorAll('[data-edit]').length===27,'creation produit');
 set(cashier,'#query','flamboyant');await wait(()=>d.querySelector('.plu')?.textContent==='UI001','base partagee');
 a.querySelector('[data-tab="knowledge"]').click();await wait(()=>a.querySelectorAll('[data-edit]').length===4,'liste procédures');a.querySelector('#add-item').click();set(admin,'#f-title','Étiquette test');set(admin,'#f-keywords','etiquette test; remplacer etiquette test');set(admin,'#f-answer','Réponse approuvée de test.');submit(admin,'#edit-form');
 await wait(()=>a.querySelectorAll('[data-edit]').length===5,'creation procedure');
 set(cashier,'#query','remplacer etiquette test');await wait(()=>d.querySelector('.answer-text')?.textContent==='Réponse approuvée de test.','lecture procedure');
 set(cashier,'#query','inconnu journal interface');await wait(()=>d.querySelector('.empty'),'inconnu journal');await new Promise(r=>setTimeout(r,1400));
 a.querySelector('[data-tab="logs"]').click();await wait(()=>a.querySelector('#log-table').textContent.includes('inconnu journal interface'),'journal admin');
 const voiced=await page('/',true);const v=voiced.window.document;await wait(()=>v.querySelectorAll('.product').length>0,'page vocal');v.querySelector('#mic').click();assert(v.querySelector('#voice-status').textContent.includes('Écoute'));
 const result=[{transcript:'gingembre'}];result.isFinal=true;voiced.window.testSpeech.onresult({resultIndex:0,results:[result]});
 await wait(()=>v.querySelector('.plu')?.textContent==='D018','transcription vers recherche');
 voiced.window.testSpeech.onerror({error:'not-allowed'});assert(v.querySelector('#voice-status').textContent.includes('Microphone refusé'));
 assert.deepEqual(errors,[]);
 // Clean disposable UI-created rows via authenticated application endpoints.
 for(const kind of ['products','knowledge']){const r=await admin.window.fetch('/api/admin/'+kind);const rows=(await r.json()).items;for(const row of rows.filter(r=>r.code==='UI001'||r.title==='Étiquette test'))await admin.window.fetch('/api/admin/'+kind+'/'+row.id,{method:'DELETE',headers:{'X-App-Request':'1','Content-Type':'application/json'},body:JSON.stringify({expected_updated_at:row.updated_at})});}
 for(const dom of [cashier,admin,voiced])dom.window.close();
 console.log('DOM checks passed: home, avocado, apples, procedure, refusal, login, product creation, shared database, knowledge creation, logs, voice states and denial fallback. No JavaScript errors.');
})().catch(e=>{console.error(e);process.exit(1)});
