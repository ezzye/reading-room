import test from 'node:test';import assert from 'node:assert/strict';import {sanitizePublicCapturePresentation} from './readable-presentation.mjs';
const capture={id:'saved-capture-id',url:'https://bbc.co.uk/news/article',presentation:{method:'public-url',extractorRevision:4},design:{headlineStyle:{fontFamily:'ReithSerif',fontSize:'48px',lineHeight:'52px'},bodyStyle:{fontFamily:'Arial',fontSize:'88px',lineHeight:'14px'}},blocks:[{id:'B1',type:'paragraph',text:'Preserve every original word exactly.',style:{fontFamily:'ReithSans, Arial',fontSize:'88px',lineHeight:'14px'}},{id:'B2',type:'heading',text:'Section heading',style:{fontSize:'40px',lineHeight:'46px'}},{id:'B3',type:'figure',url:'https://images.example.org/image.jpg',caption:'Original caption',rect:{x:0,y:400,width:660,height:380}},{id:'B4',type:'video',url:'https://media.example.org/video.mp4'}]};
test('read-time repair fixes stored public typography without changing source text, block IDs or media',()=>{
 const before=structuredClone(capture),repaired=sanitizePublicCapturePresentation(capture);assert.deepEqual(capture,before);assert.notEqual(repaired,capture);assert.equal(repaired.blocks[0].style.fontSize,'20px');assert.ok(parseFloat(repaired.blocks[0].style.lineHeight)>=27);assert.equal(repaired.blocks[0].style.fontFamily,'ReithSans, Arial');assert.equal(repaired.design.headlineStyle.fontSize,'48px');assert.equal(repaired.blocks[1].style.fontSize,'40px');assert.deepEqual(repaired.blocks.map(({style,...block})=>block),capture.blocks.map(({style,...block})=>block));assert.equal(repaired.id,capture.id);assert.deepEqual(sanitizePublicCapturePresentation(repaired),repaired);
});
test('Page Lens measured, library, saved-HTML and critical captures remain untouched',()=>{
 for(const presentation of [undefined,{method:'saved-html'},{method:'library-text'},{method:'measured-rendered'}]){const original={...capture,presentation};assert.equal(sanitizePublicCapturePresentation(original),original);}
});
test('unmeasured source colours cannot make stored public text disappear on its reading paper',()=>{
 const original=structuredClone(capture);original.design.articleBackground='#fff';original.design.headlineStyle.color='#f6f6f6';original.design.bodyStyle.color='rgba(0,0,0,0.05)';original.blocks[0].style.color='white';original.blocks[1].style.color='#052962';
 const repaired=sanitizePublicCapturePresentation(original);assert.equal(repaired.design.headlineStyle.color,'#171717');assert.equal(repaired.design.bodyStyle.color,'#171717');assert.equal(repaired.blocks[0].style.color,'#171717');assert.equal(repaired.blocks[1].style.color,'#052962');assert.deepEqual(repaired.blocks.map(({style,...b})=>b),original.blocks.map(({style,...b})=>b));assert.equal(original.design.headlineStyle.color,'#f6f6f6');
 original.design.articleBackground='#000';original.design.headlineStyle.color='#fff';assert.equal(sanitizePublicCapturePresentation(original).design.headlineStyle.color,'#fff');
});
test('colour repair preserves measured captures and handles transparent and short alpha hex hints',()=>{
 for(const color of ['transparent','#fff0','rgba(100%,100%,100%,0.02)','unrecognisedcolour']){const x=structuredClone(capture);x.design.headlineStyle.color=color;assert.equal(sanitizePublicCapturePresentation(x).design.headlineStyle.color,'#171717');x.presentation={method:'measured-rendered'};assert.equal(sanitizePublicCapturePresentation(x),x);}
});
test('stored public NPR typography repairs role fallbacks while preserving content and bypassing Page Lens/library',()=>{
 const original=structuredClone(capture);original.url='https://www.npr.org/2026/10/18/nx-s1-1234567/fictional';
 const fixed=sanitizePublicCapturePresentation(original);
 assert.equal(fixed.design.headlineStyle.fontFamily,'NPRSans, Helvetica, Arial, sans-serif');assert.equal(fixed.design.headlineStyle.fontSize,'32px');assert.equal(fixed.design.headlineStyle.lineHeight,'40px');
 assert.equal(fixed.design.bodyStyle.fontFamily,'NPRSerif, Georgia, serif');assert.equal(fixed.blocks[0].style.fontSize,'18px');assert.equal(fixed.blocks[0].style.lineHeight,'27px');
 assert.deepEqual(fixed.blocks.map(({style,...b})=>b),original.blocks.map(({style,...b})=>b));assert.deepEqual(sanitizePublicCapturePresentation(fixed),fixed);
 for(const presentation of [undefined,{method:'saved-html'},{method:'library-text'}]){const other={...original,presentation};assert.equal(sanitizePublicCapturePresentation(other),other);}
 const libraryFlag={...original,diagnostics:{libraryTextEdition:true}};assert.equal(sanitizePublicCapturePresentation(libraryFlag),libraryFlag);
});
