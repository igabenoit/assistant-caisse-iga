const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('templates/photo_trial.html','utf8'),{runScripts:'outside-only',url:'https://example.test/essai-photo'}),w=dom.window;
w.AbortController=AbortController;
w.eval(fs.readFileSync('static/photo_recognition.js','utf8'));
const scores=new Array(1000).fill(0);scores[954]=.9;
assert.equal(w.photoRecognition.candidates(scores)[0].query,'banane');
scores[954]=.12;assert.equal(w.photoRecognition.candidates(scores).length,0);
scores[954]=.3;scores[1]=.6;assert.equal(w.photoRecognition.candidates(scores).length,0);
function synthetic(background,subject){const width=64,height=64,data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const color=x>=18&&x<46&&y>=14&&y<50?subject:background,i=(y*width+x)*4;data.set([...color,255],i);}return{data,width,height};}
for(const background of [[255,255,255],[112,72,42]]){const plan=w.photoRecognition.subjectPlan(synthetic(background,[220,92,28]));assert.ok(plan);assert.ok(plan.coverage>.15&&plan.coverage<.5);assert.ok(plan.box.x<=18&&plan.box.right>=46&&plan.box.y<=14&&plan.box.bottom>=50);}
w.eval(fs.readFileSync('static/photo_trial.js','utf8')+'\nwindow.runPhoto=recognizePhoto;window.setPhoto=()=>{photoCanvas={};};window.resetPhoto=resetPhoto;');
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
 let finish;w.photoRecognition.recognize=()=>new Promise(r=>finish=r);w.setPhoto();const stale=w.runPhoto();w.resetPhoto();finish([{label:'Banane',query:'banane'}]);await stale;
 assert.equal(w.document.querySelector('#photo-suggestions').textContent,'');
 w.photoRecognition.recognize=async()=>[{label:'Banane',query:'banane'}];w.setPhoto();await w.runPhoto();
 const area=w.document.querySelector('#photo-suggestions');assert.match(area.textContent,/Banane/);assert.doesNotMatch(area.textContent,/0004011/);
 let request;w.fetch=async(url,options)=>{request={url,options};return {ok:true,json:async()=>({products:[{id:'1',name:'Banane',code:'0004011',demo:false}]})};};
 area.querySelector('button').click();await tick();assert.equal(request.url,'/api/search');assert.deepEqual(JSON.parse(request.options.body),{query:'banane',record:false,device:'Essai photo'});
 assert.doesNotMatch(area.textContent,/0004011/);area.querySelector('button').click();assert.match(area.textContent,/0004011/);
 w.photoRecognition.recognize=async()=>{throw Error('Connexion indisponible');};await w.runPhoto();assert.match(w.document.querySelector('#photo-status').textContent,/Connexion indisponible/);assert.equal(w.document.querySelector('#recognize-photo').disabled,false);
 dom.window.close();console.log('Recognition: supported/unknown classes, stale inference, explicit catalog choice, exact code preservation, no image in request, retry after error passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
