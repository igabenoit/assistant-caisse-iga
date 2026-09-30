const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('templates/photo_bank.html','utf8'),{runScripts:'outside-only',url:'https://example.test/'}),w=dom.window;
w.document.body.dataset.product='';w.AbortController=AbortController;
const saved=[],stages=[];let pending=[{id:'one',model:'legacy',image:'/old/one'},{id:'two',model:'legacy',image:'/old/two'}],fail=true;
w.URL.createObjectURL=()=> 'blob:reference';w.URL.revokeObjectURL=()=>{};
w.Image=class{constructor(){this.naturalWidth=400;this.naturalHeight=300;}set src(v){queueMicrotask(()=>this.onload());}};
w.HTMLCanvasElement.prototype.getContext=()=>({fillRect(){},drawImage(){}});
w.photoRecognition={modelId:'new',isolateSubject:c=>{stages.push('isolate');return c;},embedPrepared:async()=>{stages.push('embed');return [1,0];}};
w.fetch=async(url,opts={})=>{
 if(url.startsWith('/old/')){if(url.endsWith('two')&&fail)return{ok:false};return{ok:true,blob:async()=>new w.Blob(['jpeg'],{type:'image/jpeg'})};}
 let data={};if(url==='/api/admin/products')data={items:[]};
 if(url==='/api/admin/photo-migration')data={photos:[...pending]};
 if(url.endsWith('/migrate')){const body=JSON.parse(opts.body);assert.equal(body.source_model,'legacy');assert.deepEqual(body.embedding,[1,0]);const id=url.split('/')[4];saved.push(id);pending=pending.filter(p=>p.id!==id);}
 return{ok:true,json:async()=>data};
};
w.eval(fs.readFileSync('static/photo_bank.js','utf8')+'\nwindow.retryMigration=migratePhotos;');
(async()=>{
 for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));
 assert.deepEqual(saved,['one']);assert.match(w.document.querySelector('#bank-status').textContent,/1 photo\(s\) non convertie/);
 assert.equal(w.document.querySelector('#bank-filter').disabled,false);
 fail=false;await w.retryMigration();assert.deepEqual(saved,['one','two']);assert.deepEqual(stages,['isolate','embed','isolate','embed']);
 await w.retryMigration();assert.equal(saved.length,2);
 console.log('Migration: originals fetched, isolated before embedding, failed image retained, resume without duplicates passed.');dom.window.close();
})().catch(e=>{console.error(e);dom.window.close();process.exitCode=1;});
