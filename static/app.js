'use strict';
const $=s=>document.querySelector(s);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storage={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};
let device=(storage.get('caisse-device')==='Ma tablette'?'Mon appareil':storage.get('caisse-device'))||'Mon appareil', revision='', eventId='', source='text', debounce, recordTimer, controller, requestNumber=0, events, poll;
let currentProducts=[], currentQuery='', recognition, listening=false, voiceTimer, voicePending=false, voiceGeneration=0, voiceStartTimer, voiceFinishTimer, voiceAvailable=false;
let photoPending=false,photoPickerOpen=false,photoGeneration=0,photoQueries=[],photoPickerTimer;
const REQUEST_TIMEOUT_MS=12000;
const uid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now().toString(16).padStart(8,'0').slice(-8)}-0000-4000-8000-${Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>n.toString(16).padStart(2,'0')).join('')}`;
async function api(url, options={}){
 const timeoutController=new AbortController();let timedOut=false;
 const callerSignal=options.signal;const cancel=()=>timeoutController.abort();
 if(callerSignal?.aborted)cancel();else callerSignal?.addEventListener('abort',cancel,{once:true});
 const timer=setTimeout(()=>{timedOut=true;timeoutController.abort();},REQUEST_TIMEOUT_MS);
 try{const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options,signal:timeoutController.signal,headers:{'X-App-Request':'1',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});
 let data;try{data=await response.json();}catch{throw new Error('Le serveur est momentanément indisponible. Réessaie.');}
 if(!response.ok){if(response.status===401){stopSync();$('#cashier').classList.add('hidden');$('#gate').classList.remove('hidden');}throw new Error(data.error||'Le serveur ne répond pas.');}
 return data;
 }catch(e){if(timedOut)throw new Error('Le serveur met trop de temps à répondre. Réessaie.');throw e;}finally{clearTimeout(timer);callerSignal?.removeEventListener('abort',cancel);}
}
function showConnection(message=''){$('#connection').textContent=message;$('#connection').classList.toggle('hidden',!message);$('#sync-status').textContent=message?'Connexion interrompue':'Base centrale · À jour';}
const mixedVarietyPhotos=new Set(['/static/images/demo-23.jpg','/static/images/demo-24.jpg','/static/images/demo-25.jpg']);
function imageHtml(p){if(mixedVarietyPhotos.has(p.image))return '<span class="placeholder">Photo de cette variété à ajouter</span>';return p.image?`<img src="${escape(p.image)}" alt="${escape(p.name)}" loading="lazy" decoding="async" width="480" height="480">`:'<span class="placeholder">Photo à ajouter</span>';}
function renderProducts(items,home=false){
 $('#results-title').textContent=home?'Produits courants':'Produits trouvés';$('#results-count').textContent=`${items.length} produit${items.length>1?'s':''}`;
 $('#results').innerHTML=`<div class="grid ${items.length===1?'single':''}">${items.map(p=>`<article class="product"><div class="product-photo">${p.demo?'<span class="demo-tag">DÉMO</span>':''}${imageHtml(p)}</div><div class="product-body"><span class="product-category">${escape(p.category||'Produit')}</span><h3>${escape(p.name)}</h3><span class="code-label">${p.demo?'CODE FICTIF · DÉMO':'CODE / PLU'}</span><strong class="plu">${escape(p.code)}</strong><p class="product-note">${escape(p.note||'')}</p></div></article>`).join('')}</div>`;
 const names=items.map(p=>p.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim());
 if(!home&&new Set(names).size<names.length){const note=document.createElement('p');note.className='ambiguity-note';note.textContent='Plusieurs codes portent le même nom. Vérifie la variété ou le format avec le superviseur avant de choisir.';$('#results').prepend(note);}
 $('#results').querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{img.replaceWith(Object.assign(document.createElement('span'),{className:'placeholder',textContent:'Photo indisponible'}));},{once:true}));
}
function renderAnswer(d){$('#results-title').textContent='Réponse du magasin';$('#results-count').textContent='Procédure enregistrée';$('#results').innerHTML=`<article class="answer">${d.demo?'<span class="demo-tag">PROCÉDURE DÉMO</span>':'<span class="badge">Réponse officielle enregistrée</span>'}<h3>${escape(d.title)}</h3><div class="answer-text">${escape(d.answer)}</div><p class="answer-source">Source : base du magasin · Dernière modification le ${new Date(d.updated_at).toLocaleDateString('fr-CA')} ${d.demo?'· Exemple fictif':''}</p></article>`;}
function renderResult(data){
 revision=data.revision||revision;
 if(data.products?.length){renderProducts(data.products);return;}
 if(data.answers?.length){renderAnswer(data.answers[0]);return;}
 $('#results-title').textContent='Résultat de la recherche';$('#results-count').textContent='';
 if(data.suggestions?.length){$('#results').innerHTML=`<div class="empty"><h3>Plusieurs procédures correspondent</h3><p>Précise le sujet. Si les consignes se contredisent, demande au superviseur.</p><div class="suggestions">${data.suggestions.map(s=>`<button class="secondary" data-doc="${escape(s.id)}">${escape(s.title)} ${s.demo?'· DÉMO':''}</button>`).join('')}</div></div>`;return;}
 $('#results').innerHTML=`<div class="empty"><h3>Je n’ai pas cette information.</h3><p>Demande au superviseur.</p><p class="small">${data.kind==='product'?'Essaie aussi un autre nom ou un code.':'La réponse doit être ajoutée à la base du magasin.'}</p></div>`;
}
function pendingResult(){ $('#results-title').textContent='Recherche en cours…';$('#results-count').textContent='';$('#results').setAttribute('aria-busy','true');$('#results').innerHTML='<div class="loading" role="status">Vérification du catalogue…</div>'; }
function finishResult(){ $('#results').setAttribute('aria-busy','false'); }
async function home(){
 const n=++requestNumber;controller?.abort();controller=new AbortController();pendingResult();
 try{const data=await api('/api/catalog',{signal:controller.signal});if(n!==requestNumber||$('#query').value.trim())return;revision=data.revision;currentProducts=data.products;renderProducts((data.featured||currentProducts).slice(0,9),true);showConnection();}catch(e){if(n===requestNumber&&e.name!=='AbortError'){showConnection('Connexion indisponible. Les codes à jour ne peuvent pas être affichés.');$('#results').innerHTML='<div class="empty"><h3>Catalogue indisponible</h3><button class="secondary" data-retry>Réessayer</button></div>';}}finally{if(n===requestNumber)finishResult();}
}
async function search(record=false,voiceAlternatives=[]){
 const query=$('#query').value.trim();
 if(!query){controller?.abort();requestNumber++;await home();return;}
 const n=++requestNumber;controller?.abort();controller=new AbortController();pendingResult();
 const id=eventId||(eventId=uid());
 try{
  const payload={query,device,source,event_id:id,record};
  if(source==='voice'&&voiceAlternatives.length)payload.alternatives=voiceAlternatives;
  const data=await api('/api/search',{method:'POST',signal:controller.signal,body:JSON.stringify(payload)});
  if(n!==requestNumber||query!==$('#query').value.trim())return;
  if(source==='voice'&&data.interpreted_query)$('#query').value=data.interpreted_query;
  renderResult(data);showConnection();if(!listening)$('#voice-status').textContent=source==='voice'?`J’ai entendu : ${data.interpreted_query||query}. Tu peux corriger le texte.`:(voiceAvailable?'Tape un produit, un code ou une question.':'Dictée indisponible dans ce navigateur. Utilise le clavier.');
 }catch(e){if(e.name!=='AbortError'&&n===requestNumber){$('#results').innerHTML='<div class="empty"><h3>Connexion indisponible</h3><p>Impossible de vérifier les codes. Ta recherche est conservée.</p><button class="secondary" data-retry>Réessayer</button></div>';showConnection(e.message||'Le serveur est momentanément inaccessible. Réessaie.');}}finally{if(n===requestNumber)finishResult();}
}
function inputChanged(){cancelPhoto();if(listening||voicePending){cancelVoice();}pendingResult();source='text';eventId=uid();clearTimeout(debounce);clearTimeout(recordTimer);controller?.abort();requestNumber++;$('#clear-query').classList.toggle('hidden',!$('#query').value);debounce=setTimeout(()=>search(false),180);recordTimer=setTimeout(()=>{if($('#query').value.trim())search(true)},1100);}
function submitQuery(q,kind='text',alternatives=[]){cancelPhoto();if(kind!=='voice'&&(listening||voicePending))cancelVoice();clearTimeout(debounce);clearTimeout(recordTimer);$('#query').value=q;source=kind;eventId=uid();$('#clear-query').classList.toggle('hidden',!q);search(true,alternatives);}
$('#query').addEventListener('input',inputChanged);
$('#search-form').addEventListener('submit',e=>{e.preventDefault();cancelPhoto();source='text';clearTimeout(debounce);clearTimeout(recordTimer);search(true);$('#query').blur();});
$('#clear-query').addEventListener('click',()=>{submitQuery('');$('#query').focus();});
document.querySelectorAll('[data-query]').forEach(b=>b.addEventListener('click',()=>submitQuery(b.dataset.query)));
$('#results').addEventListener('click',async e=>{if(e.target.closest('[data-retry]')){refresh();return;}const b=e.target.closest('[data-doc]');if(b){const n=++requestNumber;controller?.abort();controller=new AbortController();pendingResult();try{const d=await api('/api/knowledge/'+b.dataset.doc,{signal:controller.signal});if(n===requestNumber)renderAnswer(d);}catch(err){if(n===requestNumber&&err.name!=='AbortError'){showConnection(err.message);$('#results').innerHTML='<div class="empty">Procédure indisponible. Précise ta recherche ou demande au superviseur.</div>';}}finally{if(n===requestNumber)finishResult();}}});
function updateDevice(){$('#device-label').textContent=device;}
$('#device-button').addEventListener('click',()=>{$('#device-name').value=device;$('#device-dialog').showModal();});
$('#device-form').addEventListener('submit',e=>{e.preventDefault();device=$('#device-name').value.trim()||'Mon appareil';storage.set('caisse-device',device);updateDevice();$('#device-dialog').close();});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$('#'+b.dataset.close).close()));
$('#install-help').addEventListener('click',()=>$('#install-dialog').showModal());
$('#kiosk-login').addEventListener('submit',async e=>{e.preventDefault();try{await api('/api/login',{method:'POST',body:JSON.stringify({role:'kiosk',password:$('#kiosk-password').value})});$('#kiosk-password').value='';$('#gate').classList.add('hidden');$('#cashier').classList.remove('hidden');await refresh();startSync();}catch(err){$('#gate-error').textContent=err.message;}});
function stopVoice(){voiceGeneration++;clearTimeout(voiceTimer);clearTimeout(voiceStartTimer);clearTimeout(voiceFinishTimer);listening=false;voicePending=false;$('#mic').classList.remove('listening');$('#mic span').textContent='Parler';$('#mic').setAttribute('aria-label','Dicter une recherche');$('#mic').setAttribute('aria-pressed','false');}
function cancelVoice(message='Écoute arrêtée.'){const old=recognition;stopVoice();try{old?.abort();}catch{}$('#voice-status').textContent=message;}
function setupVoice(){
 const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
 voiceAvailable=Boolean(Speech&&window.isSecureContext);
 if(!voiceAvailable){$('#mic').disabled=true;$('#voice-status').textContent='Dictée indisponible dans ce navigateur. Utilise le clavier.';return;}
 $('#mic').setAttribute('aria-pressed','false');
 $('#mic').addEventListener('click',()=>{
  if(listening||voicePending){cancelVoice();return;}
  cancelPhoto();
  const generation=++voiceGeneration,active=()=>generation===voiceGeneration;
  const rec=new Speech();recognition=rec;rec.lang='fr-CA';rec.continuous=false;rec.interimResults=true;rec.maxAlternatives=5;
  let interimTranscript='',submitted=false;
  voicePending=true;$('#mic span').textContent='Arrêter';$('#mic').setAttribute('aria-label','Arrêter la dictée');$('#mic').setAttribute('aria-pressed','true');$('#voice-status').textContent='Démarrage du micro… Tu peux arrêter à tout moment.';
  voiceStartTimer=setTimeout(()=>{if(active())cancelVoice('Le micro ne démarre pas. Vérifie son autorisation ou utilise le clavier.');},8000);
  rec.onstart=()=>{if(!active()){try{rec.abort();}catch{}return;}clearTimeout(voiceStartTimer);voicePending=false;listening=true;$('#mic').classList.add('listening');$('#voice-status').textContent='Écoute… rapproche l’iPhone et dis seulement le nom du produit.';voiceTimer=setTimeout(()=>{if(active())cancelVoice('Écoute terminée après 15 secondes. Réessaie ou utilise le clavier.');},15000);};
  rec.onspeechend=()=>{if(!active())return;$('#voice-status').textContent='Traitement…';clearTimeout(voiceFinishTimer);voiceFinishTimer=setTimeout(()=>{if(active())try{rec.stop();}catch{cancelVoice('La dictée ne répond plus. Réessaie dans Safari ou utilise le clavier.');}},800);};
  rec.onresult=e=>{if(!active())return;let interim='';for(let i=e.resultIndex;i<e.results.length;i++){const result=e.results[i],t=result[0].transcript;if(result.isFinal){const alternatives=[];for(let j=0;j<Math.min(result.length,5);j++){const candidate=result[j].transcript.trim();if(candidate&&!alternatives.includes(candidate))alternatives.push(candidate);}submitted=true;stopVoice();try{rec.abort();}catch{}submitQuery(t.trim(),'voice',alternatives);return;}interim+=t;}if(interim){interimTranscript=interim.trim();$('#voice-status').textContent='Écoute… '+interimTranscript;}};
  rec.onnomatch=()=>{if(active())$('#voice-status').textContent='Je n’ai pas compris le produit. Rapproche l’iPhone et réessaie.';};
  rec.onerror=e=>{if(!active())return;stopVoice();const standalone=window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;const msgs={'not-allowed':'Microphone refusé. Sur iPhone : Réglages, Safari, Microphone, puis Autoriser.','service-not-allowed':standalone?'La dictée ne démarre pas dans l’app installée. Ouvre le site directement dans Safari.':'La dictée de l’iPhone n’est pas autorisée. Vérifie Siri et Dictée, ou utilise le clavier.','no-speech':'Aucune parole entendue. Rapproche l’iPhone, dis seulement le nom du produit et réessaie.','audio-capture':'L’iPhone ne donne pas accès au microphone. Ferme les autres appels ou apps audio, puis réessaie.','network':'Le service vocal n’arrive pas à joindre le réseau. Essaie les données cellulaires ou utilise la dictée du clavier.','aborted':'Écoute arrêtée.'};$('#voice-status').textContent=msgs[e.error]||'Dictée indisponible. Ouvre le site dans Safari ou utilise le clavier.';};
  rec.onend=()=>{if(!active()||submitted)return;const fallback=interimTranscript.trim();stopVoice();if(fallback){submitted=true;submitQuery(fallback,'voice',[fallback]);return;}$('#voice-status').textContent='Écoute terminée sans résultat. Rapproche l’iPhone et réessaie, ou utilise le micro du clavier.';};
  try{rec.start();}catch{cancelVoice('Impossible de démarrer la dictée. Utilise le clavier.');}
 });
}
function stopSync(){events?.close();events=null;clearInterval(poll);poll=null;}
async function refresh(){if(photoPending||photoPickerOpen)return;if(source==='photo'&&photoQueries.length){await searchPhotoCatalog(photoQueries);return;}if($('#query').value.trim())await search(false);else await home();}
function startSync(){
 stopSync();
 let checking=false;
 poll=setInterval(async()=>{if(document.hidden||checking||photoPending||photoPickerOpen)return;checking=true;try{const d=await api('/api/revision');if(d.revision!==revision||!$('#connection').classList.contains('hidden')){revision=d.revision;await refresh()}}catch{showConnection('Connexion interrompue. Les résultats affichés peuvent avoir changé.');$('#results').innerHTML='';}finally{checking=false;}},15000);
}
window.addEventListener('offline',()=>{cancelPhoto();clearTimeout(debounce);clearTimeout(recordTimer);cancelVoice('Hors connexion. Utilise le clavier après reconnexion.');controller?.abort();requestNumber++;finishResult();showConnection('Hors connexion. Connecte ton appareil à Internet pour vérifier les codes.');$('#results').innerHTML='';stopSync();});
window.addEventListener('online',()=>{refresh();startSync();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelVoice();stopSync();}else if(!$('#cashier').classList.contains('hidden')){refresh();startSync();}});
try{const saved=sessionStorage.getItem('caisse-update-query');sessionStorage.removeItem('caisse-update-query');if(saved){$('#query').value=saved;$('#clear-query').classList.remove('hidden');}}catch{}
(async()=>{updateDevice();setupVoice();try{const s=await api('/api/session');if(s.kiosk_required&&!s.role){$('#gate').classList.remove('hidden');return;}$('#cashier').classList.remove('hidden');await refresh();startSync();}catch{showConnection('Impossible de joindre le serveur. Recharge la page.')}})();
if('serviceWorker' in navigator){
 let controlled=Boolean(navigator.serviceWorker.controller),reloading=false;
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(!controlled){controlled=true;return;}
  if(reloading)return;reloading=true;
  const reloadWhenIdle=()=>{
   if(listening||voicePending||photoPending||photoPickerOpen||document.querySelector('dialog[open]')){setTimeout(reloadWhenIdle,1000);return;}
   try{sessionStorage.setItem('caisse-update-query',$('#query').value);}catch{}
   location.reload();
  };
  reloadWhenIdle();
 });
 navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(registration=>{
  const update=()=>{if(!document.hidden)registration.update().catch(()=>{});};
  setInterval(update,10*60*1000);document.addEventListener('visibilitychange',update);
 }).catch(()=>{});
}

// One camera action, automatic analysis and immediate catalog codes on the same screen.
function cancelPhoto(){
 photoGeneration++;photoQueries=[];photoPickerOpen=false;clearTimeout(photoPickerTimer);
 if(photoPending){controller?.abort();requestNumber++;photoPending=false;finishResult();}
}
function closePhotoPicker(){photoPickerOpen=false;clearTimeout(photoPickerTimer);}
$('#camera').addEventListener('click',()=>{
 cancelVoice();cancelPhoto();clearTimeout(debounce);clearTimeout(recordTimer);photoPickerOpen=true;
 controller?.abort();requestNumber++;$('#query').value='';$('#clear-query').classList.add('hidden');
 $('#results').replaceChildren();$('#results-title').textContent='Nouvelle photo';$('#results-count').textContent='';
 $('#voice-status').textContent='Choisis ou prends la nouvelle photo.';
 photoPickerTimer=setTimeout(closePhotoPicker,120000);
 // Warm the model while the employee takes the photo; no photo is uploaded.
 window.photoRecognition?.preload?.().catch(()=>{});
 const input=$('#quick-photo-file');input.value='';input.click();
});
$('#quick-photo-file').addEventListener('cancel',closePhotoPicker);
$('#quick-photo-file').addEventListener('change',event=>{closePhotoPicker();if(event.target.files[0])capturePhoto(event.target.files[0]);});
async function searchPhotoCatalog(queries){
 const n=++requestNumber;controller?.abort();controller=new AbortController();photoPending=true;photoQueries=queries;source='photo';pendingResult();
 $('#query').value=queries.map(q=>q.label).join(' / ');$('#clear-query').classList.remove('hidden');
 try{
  const responses=await Promise.all(queries.map(q=>api('/api/search',{method:'POST',signal:controller.signal,body:JSON.stringify({query:q.query,device,record:false})})));
  if(n!==requestNumber)return;
  revision=responses[0]?.revision||revision;
  const products=[...new Map(responses.flatMap((d,i)=>(d.products||[]).filter(p=>!queries[i].reference||p.id===queries[i].id)).filter(p=>!p.demo).map(p=>[p.id||p.code,p])).values()];
  showConnection();
  if(!products.length){$('#results-title').textContent='Photo non identifiée';$('#results-count').textContent='';$('#results').innerHTML='<div class="empty"><h3>Aucun code trouvé</h3><p>Essaie le nom du produit ou demande au superviseur.</p></div>';return;}
  renderProducts(products);$('#results-title').textContent=products.length===1?'Suggestion photo':'Codes possibles';
  const note=document.createElement('p');note.className='photo-match-note';note.textContent=products.length===1?'Vérifie que le nom correspond à ton produit.':'Vérifie la variété et la mention bio : la photo ne permet pas de choisir un seul code.';$('#results').prepend(note);
  $('#voice-status').textContent=products.length===1?'Photo analysée · Code du catalogue ci-dessous.':'Photo analysée · Les codes sont affichés ci-dessous.';
 }catch(error){if(n===requestNumber&&error.name!=='AbortError'){$('#results').innerHTML='<div class="empty"><h3>Catalogue indisponible</h3><p>Impossible de vérifier le code. Réessaie.</p><button class="secondary" data-retry>Réessayer</button></div>';showConnection(error.message);}}
 finally{if(n===requestNumber){photoPending=false;finishResult();}}
}
async function capturePhoto(file){
 cancelPhoto();cancelVoice();clearTimeout(debounce);clearTimeout(recordTimer);controller?.abort();
 $('#query').value='';$('#clear-query').classList.add('hidden');
 const current=++photoGeneration,n=++requestNumber,active=()=>current===photoGeneration&&n===requestNumber;
 photoPending=true;pendingResult();$('#results-title').textContent='Reconnaissance photo';$('#voice-status').textContent='Préparation de la photo…';
 let url;
 try{
  if(file.size>20*1024*1024)throw Error('Photo trop volumineuse. Réduis la résolution puis réessaie.');
  if(file.type&&!file.type.startsWith('image/'))throw Error('Choisis une image JPG, PNG ou WebP.');
  url=URL.createObjectURL(file);const image=new Image();
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Photo illisible. Reprends la photo ou utilise le nom.'));image.src=url;});
  if(!active())return;
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>50000000)throw Error('Photo trop grande. Réduis la résolution puis réessaie.');
  const ratio=Math.min(1,640/Math.max(image.naturalWidth,image.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*ratio);canvas.height=Math.round(image.naturalHeight*ratio);
  const context=canvas.getContext('2d');if(!context)throw Error('La photo est indisponible dans ce navigateur. Utilise le nom.');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const candidates=await window.photoRecognition.recognize(canvas,text=>{if(active())$('#voice-status').textContent=text;});
  if(!active())return;
  if(!candidates.length)throw Error('Produit non reconnu. Essaie le nom ou reprends la photo sur un fond simple.');
  await searchPhotoCatalog(candidates);
 }catch(error){if(active()){$('#results-title').textContent='Photo non identifiée';$('#results-count').textContent='';$('#results').replaceChildren();const box=document.createElement('div');box.className='empty';box.textContent=error.message||'Analyse indisponible. Utilise le nom du produit.';$('#results').append(box);$('#voice-status').textContent='Réessaie avec Photo, Parler ou le clavier.';}}
 finally{if(url)URL.revokeObjectURL(url);if(active()){photoPending=false;finishResult();}}
}
