'use strict';
// ImageNet classes identify broad families, never PLUs or bio status.
window.photoRecognition=(()=>{
 const families={937:['Brocoli','brocoli'],938:['Chou-fleur','chou fleur'],939:['Courgette','courgette'],940:['Courge spaghetti','courge spaghetti'],941:['Courge poivrée','courge poivree'],942:['Courge musquée','courge musquee'],943:['Concombre','concombre'],944:['Artichaut','artichaut'],945:['Poivron','poivron'],947:['Champignon','champignon'],948:['Pomme — variété à confirmer','pomme'],949:['Fraise','fraise'],950:['Orange','orange'],951:['Citron','citron'],952:['Figue','figue'],953:['Ananas','ananas'],954:['Banane','banane'],957:['Grenade','grenade']};
 let loading;
 function candidates(scores){
  const ranked=Array.from(scores,(score,index)=>({score,index})).sort((a,b)=>b.score-a.score);
  if(!ranked.length||!families[ranked[0].index]||ranked[0].score<.25)return [];
  return ranked.slice(0,3).filter(p=>families[p.index]&&p.score>=Math.max(.1,ranked[0].score*.3)).map(p=>({label:families[p.index][0],query:families[p.index][1]}));
 }
 function loadScript(){return new Promise((resolve,reject)=>{
  if(window.tf?.ready)return resolve();
  // Give the bundled regenerator polyfill a writable global binding under strict CSP.
  window.regeneratorRuntime=window.regeneratorRuntime||{};
  const script=document.createElement('script');script.src='/photo-assets/tf.min.js';
  const timer=setTimeout(()=>{script.remove();reject(Error('Le téléchargement est trop lent. Vérifie le Wi-Fi puis réessaie.'));},30000);
  script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('Le moteur photo ne peut pas être chargé. Vérifie la connexion puis réessaie.'));};document.head.append(script);
 });}
 async function getModel(){
  if(!loading)loading=(async()=>{
   await loadScript();await window.tf.ready();
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
   try{return await window.tf.loadLayersModel('/photo-assets/model.json',{requestInit:{signal:controller.signal}});}
   catch{throw Error('Le modèle photo ne peut pas être chargé. Vérifie le Wi-Fi puis réessaie.');}
   finally{clearTimeout(timer);}
  })().catch(error=>{loading=null;throw error;});
  return loading;
 }
 async function recognize(canvas,onStatus){
  onStatus('Chargement du moteur gratuit… Au premier essai, environ 7 Mo sont téléchargés.');
  const model=await getModel(),tf=window.tf;onStatus('Analyse de la photo sur cet appareil…');await tf.nextFrame();
  const output=tf.tidy(()=>{const pixels=tf.browser.fromPixels(canvas).toFloat();const input=tf.image.resizeBilinear(pixels,[224,224]).div(127.5).sub(1).expandDims(0);return model.predict(input);});
  try{return candidates(await output.data());}finally{output.dispose();}
 }
 return {recognize,candidates,preload:getModel};
})();
