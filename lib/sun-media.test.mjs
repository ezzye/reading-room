import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom/worker';
import {sunImageURL} from './sun-media.mjs';

const base='https://www.thesun.co.uk/news/12345678/fictional-story/';
const photo='https://www.thesun.co.uk/wp-content/uploads/2026/10/synthetic-photo.jpg';
const image=html=>parseHTML(html).document.querySelector('img');

test('Sun uses the supplied img source rather than corrupting resize query commas in srcset',()=>{
 const img=image('<img src="'+photo+'?w=960" srcset="'+photo+'?resize=300,208&amp;quality=90&amp;strip=all 300w, '+photo+'?resize=1024,708&amp;quality=90&amp;strip=all 1024w">');
 assert.equal(sunImageURL(img,base),photo+'?w=960');
 assert.notEqual(sunImageURL(img,base),base+'708&quality=90&strip=all');
});

test('Sun srcset-only fallback preserves whole publisher URLs including comma query values',()=>{
 const img=image('<img srcset="'+photo+'?resize=300,208&amp;quality=90&amp;strip=all 300w, '+photo+'?resize=1024,708&amp;quality=90&amp;strip=all 1024w">');
 assert.equal(sunImageURL(img,base),photo+'?resize=1024,708&quality=90&strip=all');
 assert.equal(new URL(sunImageURL(img,base)).searchParams.get('resize'),'1024,708');
 const unordered=image('<img srcset="'+photo+'?resize=1024,708 1024w, '+photo+'?resize=300,208 300w, '+photo+'?resize=2000,1400 2000w">');
 assert.equal(sunImageURL(unordered,base),photo+'?resize=1024,708');
});

test('Sun keeps safe lazy-load and relative image URLs and ignores placeholders',()=>{
 assert.equal(sunImageURL(image('<img src="data:image/gif;base64,AAAA" data-src="'+photo+'?w=960">'),base),photo+'?w=960');
 assert.equal(sunImageURL(image('<img data-original="/wp-content/uploads/synthetic-photo.webp">'),base),'https://www.thesun.co.uk/wp-content/uploads/synthetic-photo.webp');
 assert.equal(sunImageURL(image('<img src="data:image/gif;base64,AAAA" data-srcset="'+photo+'?resize=640,320 640w">'),base),photo+'?resize=640,320');
});

test('Sun rejects page fragments, credentials and unsafe media rather than inventing alternatives',()=>{
 for(const raw of ['208&amp;quality=90&amp;strip=all','https://www.thesun.co.uk/news/story/','http://www.thesun.co.uk/photo.jpg','https://127.0.0.1/photo.jpg','https://user:password@www.thesun.co.uk/photo.jpg',photo+'?token=private','data:image/png;base64,AAAA','javascript:alert(1)'])assert.equal(sunImageURL(image('<img src="'+raw+'">'),base),'',raw);
 assert.equal(sunImageURL(image('<img srcset="208&amp;quality=90 300w, 708&amp;quality=90 1024w">'),base),'');
});
