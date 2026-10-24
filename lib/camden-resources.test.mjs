import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMDEN_RESOURCES,camdenResource,referenceURL,REFERENCE_KIND,renderReference} from './camden-resources.mjs';

test('catalogue contains Camden home-access references and approved digital-library launchers',()=>{
 assert.equal(CAMDEN_RESOURCES.length,22);
 assert.equal(REFERENCE_KIND,'camden-reference-v1');
 assert.equal(Object.isFrozen(CAMDEN_RESOURCES),true);
 assert.equal(Object.isFrozen(CAMDEN_RESOURCES[0].hosts),true);
 for(const id of ['american-national-biography','benezit','britannica','cobra','oed','oxford-dictionaries','whos-who','grove-art','odnb','oxford-music','oxford-worlds-classics','newsbank','times-collection','times-digital-archive','libby','borrowbox','pressreader','comics-plus','kanopy','theory-test-pro','gocitizen','alison'])assert.ok(camdenResource(id),id);
 for(const id of ['ancestry','access-to-research','bfi-replay'])assert.equal(camdenResource(id),null);
 for(const resource of CAMDEN_RESOURCES)assert.ok(resource.hosts.includes(resource.searchHost),`${resource.id} searchHost must be allowlisted`);
 assert.equal(camdenResource('times-digital-archive').entryURL,'https://go.gale.com/ps/artemis?p=TTDA&u=camlib');
 assert.deepEqual(camdenResource('times-digital-archive').hosts,['gdc.galegroup.com','go.gale.com']);
 assert.equal(camdenResource('comics-plus').entryURL,'https://www.camden.gov.uk/digital-library');
 assert.equal(camdenResource('comics-plus').description,'Choose the age-appropriate collection from Camden’s digital library.');
 for(const [id,alias] of [['american-national-biography','anb.org'],['oed','oed.com'],['whos-who','ukwhoswho.com'],['benezit','oxfordartonline.com'],['odnb','oxforddnb.com'],['oxford-music','oxfordmusiconline.com'],['oxford-worlds-classics','www.oxfordworldsclassics.com'],['pressreader','pressreader.com'],['kanopy','kanopy.com'],['alison','www.alison.com']])assert.ok(camdenResource(id).hosts.includes(alias),`${id} should allow known alias ${alias}`);
 assert.equal(camdenResource('not-a-resource'),null);
});

test('reference URLs are HTTPS, resource-host-bound, and stripped of tracking and fragments',()=>{
 assert.equal(referenceURL('https://library.eb.co.uk/levels/adult?topic=poetry&utm_source=room#entry','britannica'),'https://library.eb.co.uk/levels/adult?topic=poetry');
 assert.equal(referenceURL('https://camden.cobwebinfo.com/','cobra'),'https://camden.cobwebinfo.com/');
 assert.equal(referenceURL('https://go.gale.com/ps/artemis?id=TTDA&year=2002&utm_campaign=rr','times-digital-archive'),'https://go.gale.com/ps/artemis?id=TTDA&year=2002');
 for(const raw of [
  'http://www.anb.org/','https://evil.example/','https://fake.www.anb.org/','https://user:pass@www.anb.org/','https://www.anb.org:8443/','https://www.anb.org/login','https://www.anb.org/reset-password/abc','https://www.anb.org/share/secret','https://www.anb.org/storelibrarycard','https://www.anb.org/?borrower=123','https://www.anb.org/?x=1&token=secret','https://www.anb.org/?mystery=private','https://www.anb.org/?id=abcdef0123456789abcdef0123456789','javascript:alert(1)'
 ])assert.throws(()=>referenceURL(raw,'american-national-biography'),TypeError,raw);
 assert.equal(referenceURL('https://www.anb.org/#fragment','american-national-biography'),'https://www.anb.org/');
 assert.throws(()=>referenceURL('https://www.anb.org/','unknown'),TypeError);
 assert.throws(()=>referenceURL('https://www.anb.org/','cobra'),TypeError);
});

test('reference card preserves provider reading, links to sign-in, and escapes supplied text',()=>{
 const html=renderReference({sourceURL:'https://library.eb.co.uk/levels/adult?topic=poetry',title:'A <title> & "quote"',document:{kind:REFERENCE_KIND,resourceId:'britannica',title:'Saved title',url:'https://library.eb.co.uk/levels/adult'}});
 assert.match(html,/<!doctype html>/i);
 assert.match(html,/name="viewport"/);
 assert.match(html,/target="_blank" rel="noreferrer"/);
 assert.match(html,/https:\/\/library\.eb\.co\.uk\/levels\/adult\?topic=poetry/);
 assert.match(html,/https:\/\/library\.eb\.co\.uk\/storelibrarycard\?id=camden/);
 assert.match(html,/A &lt;title&gt; &amp; &quot;quote&quot;/);
 assert.match(html,/Britannica Library/);
 assert.doesNotMatch(html,/<script>/i);
 assert.doesNotMatch(html,/article body|AI commentary/i);
 assert.throws(()=>renderReference({sourceURL:'https://evil.example/',document:{resourceId:'britannica'}}),TypeError);
 assert.throws(()=>renderReference({sourceURL:'https://example.com/',document:{resourceId:'unknown'}}),TypeError);
});
