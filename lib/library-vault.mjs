// The master key is a native runtime Secret. Only authenticated ciphertext is
// stored in D1; a database export alone cannot disclose the library account.
const encode=new TextEncoder(),decode=new TextDecoder();
const hex=b=>[...b].map(x=>x.toString(16).padStart(2,'0')).join('');
const bytes=h=>Uint8Array.from(h.match(/../g)||[],x=>parseInt(x,16));
async function keyFor(secret){if(typeof secret!=='string'||!/^[a-f0-9]{64}$/i.test(secret))throw Error('The library connection needs its server encryption setting.');return crypto.subtle.importKey('raw',bytes(secret),'AES-GCM',false,['encrypt','decrypt']);}
export async function sealLibrary(secret,value,purpose='camden-account-v1'){
 const data=encode.encode(JSON.stringify(value));if(data.length>24000)throw Error('The library connection is too large to save.');
 const nonce=crypto.getRandomValues(new Uint8Array(12)),key=await keyFor(secret);
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:encode.encode(purpose)},key,data);
 return 'v1.'+hex(nonce)+'.'+hex(new Uint8Array(encrypted));
}
export async function openLibrary(secret,envelope,purpose='camden-account-v1'){
 if(typeof envelope!=='string'||envelope.length>50000||!/^v1\.[a-f0-9]{24}\.[a-f0-9]{32,}$/.test(envelope))throw Error('The saved library connection could not be read.');
 const [,nonce,cipher]=envelope.split('.'),key=await keyFor(secret);
 try{return JSON.parse(decode.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(nonce),additionalData:encode.encode(purpose)},key,bytes(cipher))));}catch{throw Error('The saved library connection could not be decrypted. Reconnect your card.');}
}
