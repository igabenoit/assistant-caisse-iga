'use strict';
// No upload, remote recognition, persistent storage or analytics in this free trial.
const $=selector=>document.querySelector(selector);
let generation=0,previewUrl=null;
function clearPreview(){if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;$('#trial-image').removeAttribute('src');$('#photo-result').classList.add('hidden');}
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
  const ratio=Math.min(1,1280/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*ratio);canvas.height=Math.round(image.naturalHeight*ratio);
  const context=canvas.getContext('2d');if(!context)throw new Error('L’aperçu est indisponible sur ce navigateur.');
  context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));
  if(current!==generation)return;
  if(!blob)throw new Error('Impossible de préparer cette photo. Essaie une autre photo.');
  previewUrl=URL.createObjectURL(blob);$('#trial-image').src=previewUrl;$('#photo-result').classList.remove('hidden');
  $('#photo-status').textContent='Photo prête pour l’essai d’affichage. La reconnaissance n’est pas activée; aucun envoi n’a été effectué.';
 }catch(error){if(current===generation)$('#photo-status').textContent=error.message||'Impossible de préparer cette photo.';}
 finally{if(sourceUrl)URL.revokeObjectURL(sourceUrl);}
}
function openCamera(){$('#camera-file').value='';$('#camera-file').click();}
$('#take-photo').addEventListener('click',openCamera);$('#retake-photo').addEventListener('click',openCamera);
$('#choose-photo').addEventListener('click',()=>{$('#gallery-file').value='';$('#gallery-file').click();});
for(const id of ['camera-file','gallery-file'])$('#'+id).addEventListener('change',event=>previewPhoto(event.target.files[0]));
$('#clear-photo').addEventListener('click',resetPhoto);
window.addEventListener('pagehide',()=>{generation++;clearPreview();});
