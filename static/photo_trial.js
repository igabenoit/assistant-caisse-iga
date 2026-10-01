'use strict';
// No upload, remote recognition, persistent storage or analytics in this free trial.
const $=selector=>document.querySelector(selector);
let generation=0,previewUrl=null,photoCanvas=null,recognizing=false,catalogRequest=0;
function clearSuggestions(){catalogRequest++;$('#photo-suggestions').replaceChildren();$('#photo-suggestions').classList.add('hidden');}
function clearPreview(){clearSuggestions();$('#photo-diagnostic').classList.add('hidden');$('#photo-diagnostic-content').replaceChildren();photoCanvas=null;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;$('#trial-image').removeAttribute('src');$('#photo-result').classList.add('hidden');}
function resetPhoto(){generation++;clearPreview();$('#camera-file').value='';$('#gallery-file').value='';$('#photo-status').textContent='Photo retirée. Aucune photo n’a été envoyée.';}
async function previewPhoto(file){
 if(!file)return;
 const current=++generation;clearPreview();$('#photo-status').textContent='Préparation de la photo sur cet appareil…';
 let sourceUrl;
 try{
  if(file.size>20*1024*1024)throw new Error('Cette photo dépasse 20 Mo. Choisis une photo plus petite.');
  if(file.type&&!file.type.startsWith('image/'))throw new Error('Choisis une photo JPG, PNG ou WebP.');
  sourceUrl=URL.createObjectURL(file);
  const image=new Image();
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Cette photo ne peut pas être ouverte. Reprends-la avec la caméra ou choisis un fichier JPG, PNG ou WebP.'));image.src=sourceUrl;});
  if(current!==generation)return;
  if(!image.naturalWidth||!image.naturalHeight||image.naturalWidth*image.naturalHeight>50000000)throw new Error('Cette photo est trop grande. Choisis une résolution plus petite.');
  const ratio=Math.min(1,640/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*ratio);canvas.height=Math.round(image.naturalHeight*ratio);
  const context=canvas.getContext('2d');if(!context)throw new Error('L’aperçu est indisponible sur ce navigateur.');
  context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));
  if(current!==generation)return;
  if(!blob)throw new Error('Impossible de préparer cette photo. Essaie une autre photo.');
  photoCanvas=canvas;$('#photo-diagnostic').classList.remove('hidden');previewUrl=URL.createObjectURL(blob);$('#trial-image').src=previewUrl;$('#photo-result').classList.remove('hidden');
  $('#photo-status').textContent='Photo complète chargée. Touche « Reconnaître ce produit ». Aucun envoi de photo n’a été effectué.';
 }catch(error){if(current===generation)$('#photo-status').textContent=error.message||'Impossible de préparer cette photo.';}
 finally{if(sourceUrl)URL.revokeObjectURL(sourceUrl);}
}
function openCamera(){$('#camera-file').value='';$('#camera-file').click();}
$('#take-photo').addEventListener('click',openCamera);$('#retake-photo').addEventListener('click',openCamera);
$('#choose-photo').addEventListener('click',()=>{$('#gallery-file').value='';$('#gallery-file').click();});
for(const id of ['camera-file','gallery-file'])$('#'+id).addEventListener('change',event=>previewPhoto(event.target.files[0]));
$('#clear-photo').addEventListener('click',resetPhoto);
window.addEventListener('pagehide',()=>{generation++;clearPreview();});
function node(tag,text,className){const element=document.createElement(tag);element.textContent=text;if(className)element.className=className;return element;}
async function showCatalog(candidate,current){
 const request=++catalogRequest,area=$('#photo-suggestions');area.replaceChildren(node('p','Vérification du catalogue…'));
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{
  const response=await fetch('/api/search',{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json','X-App-Request':'1'},body:JSON.stringify({query:candidate.query,record:false,device:'Essai photo'})});
  if(current!==generation||request!==catalogRequest)return;
  if(response.status===401){area.replaceChildren(node('p','Connecte cet appareil avec le code du magasin pour consulter les codes.'));const link=node('a','Ouvrir la connexion du magasin','primary');link.href='/';area.append(link);return;}
  if(!response.ok)throw Error('Catalogue indisponible. Réessaie ou utilise la recherche par nom.');
  const data=await response.json();if(current!==generation||request!==catalogRequest)return;
  const products=(data.products||[]).filter(p=>!p.demo);
  area.replaceChildren(node('h2','Confirmer le produit exact'),node('p','Vérifie la variété, le format et la mention bio. La photo ne suffit pas à les déterminer.'));
  if(!products.length){area.append(node('p','Aucune fiche trouvée. Utilise la recherche par nom ou demande au superviseur.'));return;}
  const key=p=>(p.name+' '+(p.note||'')).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  for(const product of products){
   const button=node('button',product.name+(product.note?' — '+product.note:''),'secondary photo-choice');button.type='button';
   if(products.filter(p=>key(p)===key(product)).length>1){button.disabled=true;button.textContent+=' — plusieurs codes : vérifier avec le superviseur';}
   button.addEventListener('click',()=>{
    if(current!==generation||request!==catalogRequest)return;
    area.replaceChildren(node('h2',product.name),node('p','CODE / PLU DU CATALOGUE'),node('strong',product.code,'plu'),node('p',product.note||''));
    const back=node('button','Choisir un autre produit','secondary');back.addEventListener('click',()=>showCatalog(candidate,current));area.append(back);
   });area.append(button);
  }
 }catch(error){if(current===generation&&request===catalogRequest)area.replaceChildren(node('p',error.name==='AbortError'?'Le catalogue met trop de temps à répondre. Réessaie.':error.message));}
 finally{clearTimeout(timer);}
}
async function recognizePhoto(){
 if(!photoCanvas||recognizing)return;
 const current=generation,canvas=photoCanvas;recognizing=true;clearSuggestions();$('#recognize-photo').disabled=true;
 try{
  const candidates=await window.photoRecognition.recognize(canvas,text=>{if(current===generation)$('#photo-status').textContent=text;});
  if(current!==generation)return;
  const area=$('#photo-suggestions');area.classList.remove('hidden');
  if(!candidates.length){$('#photo-status').textContent='Je ne reconnais pas ce produit avec assez de confiance. Reprends une photo nette ou utilise la recherche par nom.';return;}
  $('#photo-status').textContent='Analyse terminée sur cet appareil. Confirme la suggestion ci-dessous.';
  area.append(node('h2','Est-ce bien ce produit?'));
  for(const candidate of candidates){const button=node('button',candidate.label+' — voir le catalogue','primary photo-choice');button.type='button';button.addEventListener('click',()=>showCatalog(candidate,current));area.append(button);}
  area.append(node('p','Si aucune suggestion ne correspond, reprends la photo ou cherche le nom.'));
 }catch(error){if(current===generation)$('#photo-status').textContent=error.message||'Analyse impossible sur cet appareil. Utilise la recherche par nom.';}
 finally{recognizing=false;$('#recognize-photo').disabled=false;}
}
$('#recognize-photo').addEventListener('click',recognizePhoto);
$('#sample-photo').addEventListener('click',async()=>{
 const current=++generation;clearPreview();$('#photo-status').textContent='Chargement de la photo d’exemple…';
 try{const response=await fetch('/static/images/catalog/4011-banane.jpg');if(!response.ok)throw Error();const blob=await response.blob();if(current===generation)await previewPhoto(blob);}
 catch{if(current===generation)$('#photo-status').textContent='Photo d’exemple indisponible. Choisis ta propre photo.';}
});

$('#photo-diagnostic').addEventListener('toggle',async()=>{
 if(!$('#photo-diagnostic').open||!photoCanvas)return;
 const current=generation,canvas=photoCanvas,area=$('#photo-diagnostic-content');area.replaceChildren(node('p','Vérification…'));
 try{const d=await window.photoRecognition.diagnose(canvas);if(current!==generation)return;area.replaceChildren(node('p',d.width+' × '+d.height+' pixels · '+d.products+' produits · '+d.references+' références actives'));
 for(const [label,src] of [['Photo complète',d.original],['Photo après détourage',d.prepared]]){if(!src)continue;area.append(node('h3',label));const img=document.createElement('img');img.src=src;img.alt=label;img.style.maxWidth='100%';img.style.maxHeight='320px';img.style.objectFit='contain';area.append(img);}
 if(d.error)area.append(node('p',d.error));
 for(const p of d.ranked||[])area.append(node('p',p.name+' · '+p.code+' · similarité '+p.score.toFixed(3)+' · '+p.views+' référence(s)'));
 area.append(node('p',d.accepted?.length?'La banque propose une correspondance.':'Aucune correspondance acceptée dans la banque.'));
 }catch(e){if(current===generation)area.replaceChildren(node('p',e.message));}
});
