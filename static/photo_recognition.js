'use strict';
// ImageNet classes identify broad families, never PLUs or bio status.
window.photoRecognition=(()=>{
 const families={937:['Brocoli','brocoli'],938:['Chou-fleur','chou fleur'],939:['Courgette','courgette'],940:['Courge spaghetti','courge spaghetti'],941:['Courge poivrée','courge poivree'],942:['Courge musquée','courge musquee'],943:['Concombre','concombre'],944:['Artichaut','artichaut'],945:['Poivron','poivron'],947:['Champignon','champignon'],948:['Pomme — variété à confirmer','pomme'],949:['Fraise','fraise'],950:['Orange','orange'],951:['Citron','citron'],952:['Figue','figue'],953:['Ananas','ananas'],954:['Banane','banane'],957:['Grenade','grenade']};
 let loading,featureModel,bankCache=null,bankTag='',bankLoading;
 const modelId='mobilenet-v1-050-gap-subject-v2';
 function distance(color,r,g,b){const dr=r-color[0],dg=g-color[1],db=b-color[2];return dr*dr+dg*dg+db*db;}
 function paletteFromBorder(data,width,height){
  const bins=new Map(),add=(x,y)=>{const i=(y*width+x)*4;if(data[i+3]<128)return;const key=(data[i]>>5)+'-'+(data[i+1]>>5)+'-'+(data[i+2]>>5),entry=bins.get(key)||[0,0,0,0];entry[0]+=data[i];entry[1]+=data[i+1];entry[2]+=data[i+2];entry[3]++;bins.set(key,entry);};
  const step=Math.max(1,Math.floor(Math.min(width,height)/64)),edge=Math.max(2,Math.round(Math.min(width,height)*.035));
  for(let y=0;y<height;y+=step)for(let x=0;x<width;x+=step)if(x<edge||y<edge||x>=width-edge||y>=height-edge)add(x,y);
  return [...bins.values()].sort((a,b)=>b[3]-a[3]).slice(0,8).map(v=>[v[0]/v[3],v[1]/v[3],v[2]/v[3]]);
 }
 function subjectPlan(image){
  const {data,width,height}=image,palette=paletteFromBorder(data,width,height);if(!palette.length)return null;
  const mask=new Uint8Array(width*height),seen=new Uint8Array(width*height),threshold=2600;
  for(let p=0;p<mask.length;p++){const i=p*4,r=data[i],g=data[i+1],b=data[i+2];if(data[i+3]>127&&Math.min(...palette.map(c=>distance(c,r,g,b)))>threshold)mask[p]=1;}
  let best=null,queue=new Int32Array(mask.length);
  for(let start=0;start<mask.length;start++){
   if(!mask[start]||seen[start])continue;let head=0,tail=0,area=0,minX=width,minY=height,maxX=0,maxY=0,sumX=0,sumY=0;queue[tail++]=start;seen[start]=1;
   while(head<tail){const p=queue[head++],x=p%width,y=Math.floor(p/width);area++;sumX+=x;sumY+=y;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);const around=[p-1,p+1,p-width,p+width];for(const n of around){if(n<0||n>=mask.length||seen[n]||!mask[n])continue;const nx=n%width;if(Math.abs(nx-x)>1)continue;seen[n]=1;queue[tail++]=n;}}
   const cx=sumX/area/width,cy=sumY/area/height,centrality=Math.max(0,1-Math.hypot(cx-.5,cy-.5)*1.25),score=area*(.65+.35*centrality);if(!best||score>best.score)best={area,minX,minY,maxX,maxY,score};
  }
  if(!best)return null;const coverage=best.area/(width*height);if(coverage<.008||coverage>.82)return null;
  const pad=Math.round(Math.max(best.maxX-best.minX,best.maxY-best.minY)*.12);
  return {palette,coverage,box:{x:Math.max(0,best.minX-pad),y:Math.max(0,best.minY-pad),right:Math.min(width,best.maxX+pad+1),bottom:Math.min(height,best.maxY+pad+1)}};
 }
 function isolateSubject(canvas,onStatus=()=>{}){
  onStatus('Isolement du produit et suppression du fond…');
  const max=192,ratio=Math.min(1,max/Math.max(canvas.width,canvas.height)),probe=document.createElement('canvas');probe.width=Math.max(1,Math.round(canvas.width*ratio));probe.height=Math.max(1,Math.round(canvas.height*ratio));const probeContext=probe.getContext('2d',{willReadFrequently:true});if(!probeContext)throw Error('Impossible de préparer la photo sur cet appareil.');probeContext.drawImage(canvas,0,0,probe.width,probe.height);
  const plan=subjectPlan(probeContext.getImageData(0,0,probe.width,probe.height));if(!plan)throw Error('Le produit ne se détache pas assez du fond. Rapproche-toi et place un seul produit au centre.');
  const scaleX=canvas.width/probe.width,scaleY=canvas.height/probe.height,x=plan.box.x*scaleX,y=plan.box.y*scaleY,w=(plan.box.right-plan.box.x)*scaleX,h=(plan.box.bottom-plan.box.y)*scaleY;
  const output=document.createElement('canvas');output.width=320;output.height=320;const context=output.getContext('2d',{willReadFrequently:true});if(!context)throw Error('Impossible de préparer la photo sur cet appareil.');context.fillStyle='white';context.fillRect(0,0,320,320);const fit=Math.min(288/w,288/h),dw=w*fit,dh=h*fit,dx=(320-dw)/2,dy=(320-dh)/2;context.drawImage(canvas,x,y,w,h,dx,dy,dw,dh);
  const pixels=context.getImageData(0,0,320,320),low=1700,high=6500;
  for(let py=Math.floor(dy);py<Math.ceil(dy+dh);py++)for(let px=Math.floor(dx);px<Math.ceil(dx+dw);px++){if(px<0||py<0||px>=320||py>=320)continue;const i=(py*320+px)*4,r=pixels.data[i],g=pixels.data[i+1],b=pixels.data[i+2],d=Math.min(...plan.palette.map(c=>distance(c,r,g,b)));if(d>=high)continue;const keep=Math.max(0,Math.min(1,(d-low)/(high-low)));pixels.data[i]=Math.round(255-(255-r)*keep);pixels.data[i+1]=Math.round(255-(255-g)*keep);pixels.data[i+2]=Math.round(255-(255-b)*keep);}
  context.putImageData(pixels,0,0);return output;
 }
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
 async function recognizeGeneral(canvas,onStatus){
  onStatus('Chargement du moteur gratuit… Au premier essai, environ 7 Mo sont téléchargés.');
  const prepared=isolateSubject(canvas,onStatus),model=await getModel(),tf=window.tf;onStatus('Analyse de la photo sur cet appareil…');await tf.nextFrame();
  const output=tf.tidy(()=>{const pixels=tf.browser.fromPixels(prepared).toFloat();const input=tf.image.resizeBilinear(pixels,[224,224]).div(127.5).sub(1).expandDims(0);return model.predict(input);});
  try{return candidates(await output.data());}finally{output.dispose();}
 }

 async function embedPrepared(canvas,onStatus=()=>{}){
  onStatus('Préparation du moteur photo…');const model=await getModel(),tf=window.tf;
  if(!featureModel)featureModel=tf.model({inputs:model.inputs,outputs:model.getLayer('global_average_pooling2d_1').output});
  await tf.nextFrame();
  const result=tf.tidy(()=>featureModel.predict(tf.image.resizeBilinear(tf.browser.fromPixels(canvas).toFloat(),[224,224]).div(127.5).sub(1).expandDims(0)));
  try{const values=Array.from(await result.data()),norm=Math.hypot(...values);if(!norm)throw Error('Photo inexploitable. Reprends-la.');return values.map(v=>v/norm);}finally{result.dispose();}
 }
 async function embed(canvas,onStatus=()=>{}){return embedPrepared(isolateSubject(canvas,onStatus),onStatus);}
 async function bank(){
  if(bankLoading)return bankLoading;
  bankLoading=(async()=>{
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
   try{
    const response=await fetch('/api/photo-bank',{credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:bankTag?{'If-None-Match':bankTag}:{}});
    if(response.status===304&&bankCache)return bankCache;
    if(!response.ok)throw Error('Banque photo indisponible. Vérifie la connexion au magasin.');
    const data=await response.json();if(data.model!==modelId)throw Error('Recharge la page pour mettre à jour le moteur photo.');bankCache=data;bankTag=response.headers.get('ETag')||'';return data;
   }catch(e){if(e.name==='AbortError')throw Error('La banque photo met trop de temps à répondre. Réessaie.');throw e;}
   finally{clearTimeout(timer);bankLoading=null;}
  })();return bankLoading;
 }
 function rank(vector,products){
  const ranked=products.map(p=>{
   const scores=p.vectors.filter(v=>v.length===vector.length).map(v=>v.reduce((sum,x,i)=>sum+x*vector[i],0)).filter(Number.isFinite).sort((a,b)=>b-a);
   return {...p,score:scores.length?(scores[0]*.8+(scores[1]??scores[0])*.2):-1};
  }).sort((a,b)=>b.score-a.score);
  if(!ranked.length||ranked[0].score<.75)return [];
  // These are conservative trial thresholds, not calibrated probabilities.
  return ranked.filter(p=>p.score>=.75&&p.score>=ranked[0].score-.07).slice(0,3).map(p=>({label:p.name,query:p.code,id:p.id,reference:true,image:p.image}));
 }
 async function recognizeBank(canvas,onStatus=()=>{}){
  const data=await bank();if(!data.products.length)return [];
  onStatus('Comparaison avec les photos du magasin…');const vector=await embed(canvas,onStatus);return rank(vector,data.products);
 }
 async function recognize(canvas,onStatus=()=>{}){
  onStatus('Vérification de la banque du magasin…');const data=await bank();
  if(!data.products.length)return recognizeGeneral(canvas,onStatus);
  const vector=await embed(canvas,onStatus);onStatus('Comparaison avec les produits du magasin…');return rank(vector,data.products);
 }
 return {recognize,recognizeBank,embed,embedPrepared,isolateSubject,subjectPlan,rank,bank,modelId,candidates,preload:getModel};
})();
