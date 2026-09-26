'use strict';
const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};
let device=storage.get('caisse-device')||'Ma tablette', revision='', eventId='', source='text', debounce, recordTimer, controller, requestNumber=0, events, poll;
let currentProducts=[], currentQuery='', recognition, listening=false, voiceTimer;
const uid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now().toString(16).padStart(8,'0').slice(-8)}-0000-4000-8000-${Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>n.toString(16).padStart(2,'0')).join('')}`;
async function api(url, options={}){
 const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,headers:{'X-App-Request':'1',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
 const data=await response.json();
 if(!response.ok){if(response.status===401){stopSync();$('#cashier').classList.add('hidden');$('#gate').classList.remove('hidden');}throw new Error(data.error||'Le serveur ne répond pas.');}
 return data;
}
function showConnection(message=''){$('#connection').textContent=message;$('#connection').classList.toggle('hidden',!message);$('#sync-status').textContent=message?'Connexion interrompue':'Base centrale · À jour';}
function imageHtml(p){return p.image?`<img src="${escape(p.image)}" alt="${escape(p.name)}" loading="lazy">`:'<span class="placeholder" aria-label="Photo non fournie">◉</span>';}
function renderProducts(items,home=false){
 $('#results-title').textContent=home?'À portée de main':'Produits trouvés';$('#results-count').textContent=`${items.length} produit${items.length>1?'s':''}`;
 $('#results').innerHTML=`<div class="grid ${items.length===1?'single':''}">${items.map(p=>`<article class="product"><div class="product-photo">${p.demo?'<span class="demo-tag">DÉMO</span>':''}${imageHtml(p)}</div><div class="product-body"><span class="product-category">${escape(p.category||'Produit')}</span><h3>${escape(p.name)}</h3><span class="code-label">${p.demo?'CODE FICTIF · DÉMO':'CODE / PLU'}</span><strong class="plu">${escape(p.code)}</strong><p class="product-note">${escape(p.note||'')}</p></div></article>`).join('')}</div>`;
 $('#results').querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.replaceWith(Object.assign(document.createElement('span'),{className:'placeholder',textContent:'Photo indisponible'}));},{once:true}));
}
function renderAnswer(d){$('#results-title').textContent='Réponse du magasin';$('#results-count').textContent='Procédure enregistrée';$('#results').innerHTML=`<article class="answer">${d.demo?'<span class="demo-tag">PROCÉDURE DÉMO</span>':'<span class="badge">Réponse officielle enregistrée</span>'}<h3>${escape(d.title)}</h3><div class="answer-text">${escape(d.answer)}</div><p class="answer-source">Source : base du magasin · Mise à jour le ${new Date(d.updated_at).toLocaleDateString('fr-CA')} ${d.demo?'· Exemple fictif':''}</p></article>`;}
function renderResult(data){
 revision=data.revision||revision;
 if(data.products?.length){renderProducts(data.products);return;}
 if(data.answers?.length){renderAnswer(data.answers[0]);return;}
 $('#results-title').textContent='Résultat de la recherche';$('#results-count').textContent='';
 if(data.suggestions?.length){$('#results').innerHTML=`<div class="empty"><h3>Quel sujet cherches-tu?</h3><div class="suggestions">${data.suggestions.map(s=>`<button class="secondary" data-doc="${escape(s.id)}">${escape(s.title)} ${s.demo?'· DÉMO':''}</button>`).join('')}</div></div>`;return;}
 $('#results').innerHTML=`<div class="empty"><h3>Je n’ai pas cette information.</h3><p>Demande au superviseur.</p><p class="small">${data.kind==='product'?'Essaie aussi un autre nom ou un code.':'La réponse doit être ajoutée à la base du magasin.'}</p></div>`;
}
async function home(){
 try{const data=await api('/api/catalog');revision=data.revision;currentProducts=data.products;$('#demo-banner').classList.toggle('hidden',data.demo_count===0);renderProducts(currentProducts.slice(0,9),true);showConnection();}catch(e){showConnection('Connexion indisponible. Les codes à jour ne peuvent pas être affichés.');$('#results').innerHTML='';}
}
async function search(record=false){
 const query=$('#query').value.trim();
 if(!query){controller?.abort();requestNumber++;await home();return;}
 const n=++requestNumber;controller?.abort();controller=new AbortController();
 const id=eventId||(eventId=uid());
 try{
  const data=await api('/api/search',{method:'POST',signal:controller.signal,body:JSON.stringify({query,device,source,event_id:id,record})});
  if(n!==requestNumber||query!==$('#query').value.trim())return;
  renderResult(data);showConnection();if(!listening)$('#voice-status').textContent=source==='voice'?'Résultat de la dictée. Tu peux corriger le texte.':'Tape un produit, un code ou une question.';
 }catch(e){if(e.name!=='AbortError'&&n===requestNumber){$('#results').innerHTML='<div class="empty"><h3>Connexion indisponible</h3><p>Impossible de vérifier les codes. Demande au superviseur.</p></div>';showConnection('Le serveur est momentanément inaccessible. Réessaie dans un instant.');}}
}
function inputChanged(){source='text';eventId=uid();clearTimeout(debounce);clearTimeout(recordTimer);controller?.abort();requestNumber++;$('#clear-query').classList.toggle('hidden',!$('#query').value);debounce=setTimeout(()=>search(false),180);recordTimer=setTimeout(()=>{if($('#query').value.trim())search(true)},1100);}
function submitQuery(q,kind='text'){clearTimeout(debounce);clearTimeout(recordTimer);$('#query').value=q;source=kind;eventId=uid();$('#clear-query').classList.toggle('hidden',!q);search(true);}
$('#query').addEventListener('input',inputChanged);
$('#search-form').addEventListener('submit',e=>{e.preventDefault();clearTimeout(debounce);clearTimeout(recordTimer);search(true);$('#query').blur();});
$('#clear-query').addEventListener('click',()=>{submitQuery('');$('#query').focus();});
document.querySelectorAll('[data-query]').forEach(b=>b.addEventListener('click',()=>submitQuery(b.dataset.query)));
$('#results').addEventListener('click',async e=>{const b=e.target.closest('[data-doc]');if(b){try{renderAnswer(await api('/api/knowledge/'+b.dataset.doc));}catch(err){showConnection(err.message)}}});
function updateDevice(){$('#device-label').textContent=device;}
$('#device-button').addEventListener('click',()=>{$('#device-name').value=device;$('#device-dialog').showModal();});
$('#device-form').addEventListener('submit',e=>{e.preventDefault();device=$('#device-name').value.trim()||'Ma tablette';storage.set('caisse-device',device);updateDevice();$('#device-dialog').close();});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$('#'+b.dataset.close).close()));
$('#install-help').addEventListener('click',()=>$('#install-dialog').showModal());
$('#kiosk-login').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/login',{method:'POST',body:JSON.stringify({role:'kiosk',password:$('#kiosk-password').value})});$('#kiosk-password').value='';$('#gate').classList.add('hidden');$('#cashier').classList.remove('hidden');await home();startSync();}catch(err){$('#gate-error').textContent=err.message;}});
function stopVoice(){clearTimeout(voiceTimer);listening=false;$('#mic').classList.remove('listening');$('#mic span').textContent='Parler';$('#mic').setAttribute('aria-label','Dicter une recherche');}
function setupVoice(){
 const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!Speech||!window.isSecureContext){$('#mic').disabled=true;$('#voice-status').textContent='Dictée indisponible dans ce navigateur. Utilise le clavier.';return;}
 recognition=new Speech();recognition.lang='fr-CA';recognition.continuous=false;recognition.interimResults=true;recognition.maxAlternatives=1;
 recognition.onstart=()=>{listening=true;$('#mic').classList.add('listening');$('#mic span').textContent='Arrêter';$('#mic').setAttribute('aria-label','Arrêter la dictée');$('#voice-status').textContent='Écoute… dis un produit ou une question.';voiceTimer=setTimeout(()=>recognition.stop(),15000);};
 recognition.onspeechend=()=>{$('#voice-status').textContent='Traitement…';recognition.stop();};
 recognition.onresult=e=>{let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal){stopVoice();submitQuery(t,'voice');}else interim+=t;}if(interim)$('#voice-status').textContent='Écoute… '+interim;};
 recognition.onerror=e=>{stopVoice();const msgs={'not-allowed':'Microphone refusé. Autorise le micro dans les réglages du navigateur, ou tape ta recherche.','service-not-allowed':'La dictée n’est pas autorisée. Utilise le clavier.','no-speech':'Aucune parole entendue. Réessaie ou utilise le clavier.','audio-capture':'Aucun microphone disponible. Utilise le clavier.','network':'Le service de dictée est indisponible. Utilise le clavier.','aborted':'Écoute arrêtée.'};$('#voice-status').textContent=msgs[e.error]||'Dictée indisponible. Utilise le clavier.';};
 recognition.onend=()=>{const wasListening=listening;stopVoice();if(wasListening)$('#voice-status').textContent='Écoute terminée. Tu peux réessayer ou taper ta recherche.';};
 $('#mic').addEventListener('click',()=>{if(listening){recognition.stop();return;}try{recognition.start();}catch{$('#voice-status').textContent='Impossible de démarrer la dictée. Utilise le clavier.';}});
}
function stopSync(){events?.close();events=null;clearInterval(poll);poll=null;}
async function refresh(){if($('#query').value.trim())await search(false);else await home();}
function startSync(){
 stopSync();
 if(window.EventSource){events=new EventSource('/api/updates?revision='+encodeURIComponent(revision));events.onmessage=async e=>{const r=JSON.parse(e.data);if(r.revision!==revision){revision=r.revision;await refresh();}};events.addEventListener('expired',()=>{stopSync();$('#cashier').classList.add('hidden');$('#gate').classList.remove('hidden');});}
 poll=setInterval(async()=>{if(document.hidden)return;try{const d=await api('/api/revision');if(d.revision!==revision){revision=d.revision;await refresh()}else showConnection();}catch{showConnection('Connexion interrompue. Les résultats affichés peuvent avoir changé.');$('#results').innerHTML='';}},5000);
}
window.addEventListener('offline',()=>{controller?.abort();requestNumber++;showConnection('Hors connexion. Connecte la tablette à Internet pour vérifier les codes.');$('#results').innerHTML='';stopSync();});
window.addEventListener('online',()=>{refresh();startSync();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){recognition?.abort();stopSync();}else if(!$('#cashier').classList.contains('hidden')){refresh();startSync();}});
(async()=>{updateDevice();setupVoice();try{const s=await api('/api/session');if(s.kiosk_required&&!s.role){$('#gate').classList.remove('hidden');return;}$('#cashier').classList.remove('hidden');await home();startSync();}catch{showConnection('Impossible de joindre le serveur. Recharge la page.')}})();
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
