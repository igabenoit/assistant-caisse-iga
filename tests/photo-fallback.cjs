const assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;
const source=fs.readFileSync('static/photo_recognition.js','utf8').replace(' return {recognize,', ' window.setPhotoDependencies=(b,e,g)=>{bank=b;embed=e;recognizeGeneral=g;}; return {recognize,');
w.eval(source);
(async()=>{
 let broadCalls=0;
 const broad=async()=>{broadCalls++;return [{label:'Grenade',query:'grenade'}];};
 const product={id:'pear',name:'Poire Bosc',code:'4413',vectors:[[1,0]]};
 w.setPhotoDependencies(async()=>({products:[product]}),async()=>[0,1],broad);
 assert.equal((await w.photoRecognition.recognize({}))[0].query,'grenade');assert.equal(broadCalls,1);
 assert.equal((await w.photoRecognition.recognizeBank({})).length,0);assert.equal(broadCalls,1);
 w.setPhotoDependencies(async()=>({products:[product]}),async()=>[1,0],broad);
 const matches=await w.photoRecognition.recognize({});assert.equal(matches[0].query,'4413');assert.equal(broadCalls,1);
 w.setPhotoDependencies(async()=>({products:[]}),async()=>{throw Error('No reference embedding needed');},broad);
 assert.equal((await w.photoRecognition.recognize({}))[0].query,'grenade');
 dom.window.close();console.log('Photo fallback: unmatched bank uses broad classifier, reference match stays exact, bank-only test stays bank-only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
