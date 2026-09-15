import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {JSDOM} from 'jsdom';
test('a sign-in link opened in an existing login tab updates the form without consuming it',async()=>{
 const dom=new JSDOM(fs.readFileSync(new URL('../public/login.html',import.meta.url),'utf8'),{url:'https://inboxproof.email/login',runScripts:'outside-only'});let requests=0;dom.window.fetch=async()=>{requests++;throw Error('Link must not be consumed before clicking');};dom.window.eval(fs.readFileSync(new URL('../public/login.js',import.meta.url),'utf8'));
 assert.equal(dom.window.document.querySelector('#login').hidden,false);
 dom.window.location.hash='token='+'a'.repeat(64);await new Promise(resolve=>dom.window.addEventListener('hashchange',resolve,{once:true}));
 assert.equal(dom.window.document.querySelector('#login').hidden,true);assert.equal(dom.window.document.querySelector('#verify').hidden,false);assert.equal(dom.window.location.hash,'');assert.equal(requests,0);dom.window.close();
});
