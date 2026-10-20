export function addHeadlinePassageAnchors(document,blocks){
 const normal=text=>text.replace(/\s+/g,' ').trim();
 const paragraphs=[...document.querySelectorAll('.source-block p,.source-block blockquote')];
 for(const block of blocks){
  if(document.getElementById(block.id)||!/^[-\w]{1,80}$/.test(block.id))continue;
  const matches=paragraphs.filter(p=>normal(p.textContent)===normal(block.text));
  if(matches.length!==1)continue;
  const anchor=document.createElement('span');anchor.id=block.id;anchor.className='rrhc-passage-anchor';matches[0].prepend(anchor);
 }
}

export function appendHeadlineCheck(document,config){
 const panel=document.createElement('details');panel.id='rr-headline-check';panel.className='rr-headline-check';
 const summary=document.createElement('summary');summary.textContent='AI headline-versus-article check';
 const label=document.createElement('p');label.className='rrhc-label';label.textContent='Optional AI analysis · DeepSeek';
 const intro=document.createElement('p');intro.textContent='Opening this sends the saved headline and article text to DeepSeek for comparison. It uses the saved reporting, rather than checking claims against outside sources.';
 const status=document.createElement('p');status.id='rrhc-status';status.setAttribute('role','status');status.textContent='Open to compare the headline with the saved article.';
 const result=document.createElement('div');result.id='rrhc-result';
 const retry=document.createElement('button');retry.type='button';retry.id='rrhc-retry';retry.textContent='Try again';retry.hidden=true;
 panel.append(summary,label,intro,status,result,retry);
 const heading=document.querySelector('.article-top h1')||document.querySelector('h1');
 const anchor=document.querySelector('.article-top')||heading;
 if(anchor)anchor.after(panel);else (document.querySelector('main')||document.body).prepend(panel);
 const style=document.createElement('style');style.textContent=`#rr-headline-check{max-width:1000px;margin:18px 0;padding:12px 16px;border:1px solid #d8deda;border-radius:7px;background:#f6f8f6;color:#172b35;font:15px/1.55 system-ui,sans-serif;overflow-wrap:anywhere}#rr-headline-check:not([open]){padding:8px 14px;background:transparent}#rr-headline-check>summary{cursor:pointer;font:600 14px/1.5 system-ui,sans-serif;min-height:28px}#rr-headline-check .rrhc-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#385e55}#rr-headline-check h3{font:600 18px/1.4 system-ui,sans-serif;margin:16px 0 8px}#rr-headline-check .rrhc-finding{border-top:1px solid #d8deda;padding-top:10px}#rr-headline-check a{color:#005a8d}#rr-headline-check button{background:#173f37;color:white;border-radius:5px;padding:9px 13px;font:600 14px system-ui}#rr-headline-check [hidden]{display:none!important}#rr-headline-check summary:focus-visible,#rr-headline-check a:focus-visible{outline:3px solid #d6a11a;outline-offset:3px}.passage:target,.review-row:target{scroll-margin-top:120px;outline:2px solid #b8861b;outline-offset:5px}`;
 style.textContent+=' .rrhc-passage-anchor{display:block;scroll-margin-top:120px}.source-block p:has(>.rrhc-passage-anchor:target){outline:2px solid #b8861b;outline-offset:5px}';
 document.head.append(style);
 const script=document.createElement('script');script.id='rr-headline-check-script';script.textContent='('+headlineCheckClient.toString()+')('+JSON.stringify(config).replace(/</g,'\\u003c')+');';document.body.append(script);
}

function headlineCheckClient(config){
 const root=document.getElementById('rr-headline-check');if(!root)return;
 // Also reset restored/back-forward state: analysis is always an explicit choice.
 const close=()=>{root.open=false;};close();window.addEventListener('pageshow',close);
 const state=document.getElementById('rrhc-status'),output=document.getElementById('rrhc-result'),retry=document.getElementById('rrhc-retry');let busy=false,loaded=false;
 const labels={supported:'Supported in the saved text',qualified:'Qualified by the saved text',not_supported:'Not established by the saved text',unclear:'Unclear from the saved text'};
 function paragraph(text){const p=document.createElement('p');p.textContent=text;return p;}
 function render(check){
  output.replaceChildren(paragraph(check.summary));
  for(const finding of check.findings){
   const item=document.createElement('section');item.className='rrhc-finding';const title=document.createElement('h3');title.textContent='“'+finding.headlinePhrase+'”';
   const assessment=document.createElement('strong');assessment.textContent=labels[finding.assessment]||'AI observation';
   item.append(title,assessment,paragraph(finding.explanation));
   const links=document.createElement('p');links.append('Check the reporting: ');
   for(const id of finding.passageIds){if(!/^[-\w]{1,80}$/.test(id)||!document.getElementById(id))continue;const a=document.createElement('a');a.href='#'+encodeURIComponent(id);a.textContent='Passage '+id;links.append(a,' ');}item.append(links);output.append(item);
  }
  const limits=document.createElement('ul');for(const text of check.limitations){const li=document.createElement('li');li.textContent=text;limits.append(li);}output.append(limits);
 }
 async function run(){
  if(!root.open||busy||loaded)return;busy=true;retry.hidden=true;root.setAttribute('aria-busy','true');state.textContent='Comparing the headline with the saved article…';
  try{
   const response=await fetch('/api/room-headline-check?room='+encodeURIComponent(config.roomId),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Reading-Room':'1'},body:JSON.stringify({id:config.pageId})});
   const data=await response.json();if(!response.ok)throw Error(data.error||'The headline check is unavailable.');
   if(!data.available){state.textContent=data.message||'The original article body is unavailable for comparison.';loaded=true;return;}
   render(data.check);state.textContent='AI comparison of the saved article. Check the linked passages and make your own judgment.';loaded=true;
  }catch(e){state.textContent=e instanceof Error?e.message:'The headline check is unavailable.';retry.hidden=false;}finally{busy=false;root.removeAttribute('aria-busy');}
 }
 root.addEventListener('toggle',()=>{if(root.open)run();});retry.addEventListener('click',run);
}
