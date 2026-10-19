import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {bibliographyStructure} from './newsbank-bibliography-structure.mjs';
import {SCOTSMAN_CATALOGUE_NAME} from './newsbank-source-search.mjs';
import {SCOTLAND_ON_SUNDAY_PUBLICATION_LABEL as exact} from './library-publications.mjs';

const page=(inside='',siblings='')=>parseHTML('<!doctype html><html><body><main class="document-view">'+siblings+'<div id="document-view--ascii"><h1>PRIVATE-TITLE</h1><div class="document-view__meta"><p class="document-view__date">PRIVATE-DATE</p><p class="safe_with_underscore private-token abcdefabcdef '+('q'.repeat(40))+'" id="PRIVATE-ID">PRIVATE-AUTHOR</p><p>PRIVATE-WORD-COUNT</p></div>'+inside+'<div class="document-view__body--ascii"><p>'+exact+'</p><p>PRIVATE-ARTICLE-PROSE</p></div></div></main></body></html>').document;
const inspect=document=>{const root=document.querySelector('#document-view--ascii');return bibliographyStructure(root,root.querySelector('.document-view__meta'),'scotsman');};

test('bounded bibliography AST retains safe classes and complete public source labels without metadata text or article prose',()=>{
 const result=inspect(page('<div class="document-view__publication"><cite><span class="source-name">'+exact+'</span></cite></div>','<header><span class="document-view__source">Scotland on Sunday</span></header>'));
 assert.equal(result.metadataChildren.length,3);assert.deepEqual(result.metadataChildren[1].classes,['safe_with_underscore']);assert.equal(result.metadataChildren[1].redactedClasses,3);assert.equal(result.labelHits.length,2);assert.equal(result.labelHits[0].basis,'exact-registered-label');assert.equal(result.labelHits[0].scope,'ascii');assert.equal(result.labelHits[0].label,exact);assert(result.labelHits[0].ancestors.some(item=>item.role==='ascii-root'));assert.equal(result.labelHits[1].scope,'parent-sibling');assert.equal(result.labelHits[1].basis,'public-display-name');assert.doesNotMatch(JSON.stringify(result),/PRIVATE|private-token|abcdefabcdef|q{20}|"id"|href|https/);
});

test('candidate labels are whole finite public names or qualified Scotsman names, and never publication proof',()=>{
 const result=inspect(page('<span>The Scotsman (Edinburgh, Scotland)</span><span>'+SCOTSMAN_CATALOGUE_NAME+'</span><p>Scotsman reveals PRIVATE reporting about a public matter (Scotland)</p><span>Scotsman (PRIVATE account, Scotland)</span><span>Scotsman (Jane Smith, Scotland)</span>','<span>The Scotsman (Edinburgh, Scotland)</span>'));
 assert.deepEqual(result.labelHits.map(hit=>hit.basis),['qualified-publication-candidate','catalogue-family-name']);assert.equal(Object.hasOwn(result,'publicationVerified'),false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|account|Jane|Smith|reveals|reporting/);
});

test('hidden, body, script, form, control and distant page text never becomes bibliographic diagnostic content',()=>{
 const excluded=['<div hidden>','<div inert>','<div style="opacity:0">','<form>','<script>','<button>','<label for="PRIVATE-ID">','<div class="document-view__body--ascii">'];
 for(const opening of excluded){const closing=opening.startsWith('<form')?'</form>':opening.startsWith('<script')?'</script>':opening.startsWith('<button')?'</button>':opening.startsWith('<label')?'</label>':'</div>';const result=inspect(page(opening+exact+closing));assert.deepEqual(result.labelHits,[]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|Edinburgh/);}
 const document=page();document.body.insertAdjacentHTML('beforeend','<aside>'+exact+'</aside>');assert.deepEqual(inspect(document).labelHits,[]);
 assert.equal(inspect(document).rootAncestors[0].role,'document-parent');assert.deepEqual(inspect(document).rootAncestors[0].classes,['document-view']);assert(inspect(document).rootAncestors.length<=4);assert.doesNotMatch(JSON.stringify(inspect(document).rootAncestors),/PRIVATE|"id"|href|textContent/);
 const fragment=parseHTML('<main><div id="document-view--ascii"><div class="document-view__meta"></div></div><body>'+exact+'</body></main>').document;assert.deepEqual(inspect(fragment).labelHits,[]);
});

test('wrapper representations deduplicate while distinct fields and output bounds remain visible',()=>{
 const wrapped=inspect(page('<div><span>'+exact+'</span></div>'));assert.equal(wrapped.labelHits.length,1);assert.equal(wrapped.labelHits[0].node.tag,'span');
 const split=inspect(page('<div><span>Scotland on Sunday</span> (Edinburgh, Scotland)</div>'));assert.equal(split.labelHits.length,1);assert.equal(split.labelHits[0].basis,'exact-registered-label');
 const repeated=inspect(page(Array.from({length:40},()=>'<span>'+exact+'</span>').join('')));assert(repeated.labelHits.length<=8);assert.equal(repeated.truncated,true);assert(new TextEncoder().encode(JSON.stringify(repeated)).byteLength<=8000);assert(repeated.elementsInspected<=2000);
});
