const $=id=>document.getElementById(id);
const selection=JSON.parse($('sources').textContent);
if(!/^[a-zA-Z0-9_-]{1,80}$/.test(selection.room?.id||''))throw Error('No validated room was supplied.');
let run=null,busy=false,paused=false,localError='';
const selected=selection.families.flatMap(f=>f.stories.map(s=>({...s,family:f.family})));
const selectedURLs=new Set(selected.map(s=>canonical(s.url)));
async function api(path,body){
 const target=new URL(path,location.origin);target.searchParams.set('room',selection.room.id);
 const response=await fetch(target.pathname+target.search,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{'X-Reading-Room':'1',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 let value={};try{value=await response.json();}catch{}
 if(!response.ok)throw Object.assign(new Error(value.error||'This check could not be completed.'),{status:response.status});
 return value;
}
function safeLink(value){try{const url=new URL(value,location.origin);if(url.origin===location.origin&&/^\/read\/[a-f0-9]{48}$/.test(url.pathname)&&url.searchParams.get('room')===selection.room.id)return url.pathname+url.search;}catch{}return '';}
function canonical(value){try{const u=new URL(value);u.hostname=u.hostname.replace(/^www\./,'');u.hash='';for(const k of [...u.searchParams.keys()])if(/^utm_|^CMP$|^fbclid$|^gclid$/i.test(k))u.searchParams.delete(k);return u.href.replace(/\/$/,'');}catch{return value;}}
function node(tag,text,cls){const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;}
function draw(){
 const entries=(run?.entries||[]).filter(e=>selectedURLs.has(canonical(e.url))),map=new Map(entries.map(e=>[canonical(e.url),e]));
 const rows=[];
 for(const family of selection.families){
  if(!family.stories.length){const tr=node('tr');tr.append(node('td',family.family),node('td','No pair of story links observed'),node('td',family.error||'Unresolved homepage', 'failed'),node('td','Not tested'));rows.push(tr);continue;}
  for(const story of family.stories){const entry=map.get(canonical(story.url)),tr=node('tr'),paper=node('td',family.family),source=node('td'),a=node('a',story.title);a.href=story.url;a.target='_blank';a.rel='noreferrer';source.append(a,node('small',story.url));const result=node('td'),state=entry?.status||'not started';result.append(node('div',state,state==='saved'||state==='succeeded'||state==='cached'?'result ok':state==='failed'?'result failed':'result'));
   if(entry?.error)result.append(node('small',entry.error));
   const href=safeLink(entry?.href);if(href){const link=node('a','Open in room');link.href=href;link.target='_blank';link.rel='noopener';result.append(link);}
   const counts=node('td');const summary=entry?.summary||entry;const fields=[['paragraphCount','paragraphs'],['imageCount','image references'],['videoCount','video references'],['annotationCount','AI comments']];const values=fields.filter(([k])=>Number.isFinite(summary?.[k])).map(([k,label])=>summary[k]+' '+label);counts.textContent=values.join(' · ')||'Not measured';tr.append(paper,source,result,counts);rows.push(tr);
  }
 }
 $('results').replaceChildren(...rows);
 const done=entries.filter(e=>!['approved','pending','queued'].includes(e.status)).length;
 $('progress').textContent=run?`${done} of ${entries.length} attempts recorded · ${entries.filter(e=>['saved','succeeded','cached'].includes(e.status)).length} editions added or reused`:`${selected.length} selected stories · no run started`;
 $('selection-summary').textContent=`Adding to ${selection.room.name||'your room'}: ${selection.families.length} newspaper website families; ${selected.length} observed story links. The table includes access failures.`;
 const pending=entries.some(e=>['approved','pending','queued'].includes(e.status));
 $('create').disabled=busy||!!run;$('first-ten').disabled=busy||!pending;$('continue').disabled=busy||!pending;$('pause').disabled=!busy;$('refresh').disabled=busy;
}
async function refresh(){const data=await api('/api/room/press-audit');run=(data.runs||[]).find(x=>x.label===selection.label)||null;draw();}
async function execute(limit){
 if(busy||!run)return;busy=true;paused=false;localError='';draw();let attempted=0;
 try{
  for(const entry of run.entries){
   if(paused||attempted>=limit)break;
   if(!selectedURLs.has(canonical(entry.url))||!['approved','pending','queued'].includes(entry.status))continue;
   attempted++;$('status').textContent=`Checking ${new URL(entry.url).hostname} · ${attempted} in this group…`;
   try{await api('/api/room-articles',{url:entry.url,sourceHeadline:entry.sourceHeadline||undefined,auditRunId:run.id,auditEntryId:entry.id,requestId:crypto.randomUUID(),tryOriginal:true});}
   catch(error){localError=error.message;}
   const data=await api('/api/room/press-audit?run='+encodeURIComponent(run.id));run=(data.runs||[]).find(x=>x.id===run.id)||data.run||run;draw();
  }
  $('status').textContent=(paused?'Paused.':'This group is complete.')+(localError?' Latest refusal: '+localError:'');
 }catch(error){$('status').textContent=error.message;}finally{busy=false;draw();}
}
$('create').onclick=async()=>{try{$('create').disabled=true;const data=await api('/api/room/press-audit',{label:selection.label,urls:selected.map(s=>({url:s.url,sourceHeadline:s.title}))});run=data.run;draw();$('status').textContent='Source list approved. Start with the first ten stories.';}catch(error){$('status').textContent=error.message;await refresh().catch(()=>{});}};
$('first-ten').onclick=()=>execute(10);$('continue').onclick=()=>execute(96);$('pause').onclick=()=>{paused=true;$('status').textContent='Pausing after the current story.';};$('refresh').onclick=()=>refresh().catch(error=>$('status').textContent=error.message);
$('download').onclick=()=>{const file=new Blob([JSON.stringify({selection,run},null,2)],{type:'application/json'}),url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download='reading-room-press-check-results.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);};
$('shelf-link').onclick=async event=>{event.preventDefault();try{await api('/api/rooms',{action:'switch',roomId:selection.room.id});location.assign('/study');}catch(error){$('status').textContent=error.message;}};
refresh().catch(error=>{$('status').textContent=error.message;draw();});
