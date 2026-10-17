const PAGE_RE=/^[a-f0-9]{48}$/;
const ROOM_RE=/^[a-zA-Z0-9_-]{1,80}$/;

/** Add the private, member-bound discussion without changing the source article. */
export function withRoomDiscussion(html,page,{roomId=''}={}){
  if(typeof html!=='string'||!PAGE_RE.test(page?.id||''))return html;
  const config=JSON.stringify({pageId:page.id,roomId:ROOM_RE.test(roomId)?roomId:''}).replace(/</g,'\\u003c');
  const section=`<section id="ret-room-discussion" aria-labelledby="ret-room-discussion-title">
    <div class="rrd-heading"><div><p class="rrd-eyebrow">PRIVATE ROOM</p><h2 id="ret-room-discussion-title">Discussion</h2></div><span id="rrd-count" aria-live="polite"></span></div>
    <div id="rrd-comments" aria-live="polite"></div><div id="rrd-compose-slot"></div>
    <form id="rrd-form"><label id="rrd-form-label" for="rrd-text">Add your perspective</label><textarea id="rrd-text" rows="3" maxlength="1500" required placeholder="What would you add to the discussion?"></textarea><div class="rrd-form-actions"><span id="rrd-limit">0 / 1500</span><button id="rrd-cancel" type="button" hidden>Cancel</button><button id="rrd-submit" type="submit">Post</button></div></form>
    <p id="rrd-state" role="status"></p>
  </section>`;
  const style=`<style id="ret-room-discussion-style">#ret-room-discussion{box-sizing:border-box;max-width:760px;margin:clamp(32px,6vw,72px) auto;padding:clamp(18px,4vw,32px);background:#fff;color:#202124;border:1px solid #dedede;border-radius:16px;box-shadow:0 8px 28px #0000000b;font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#ret-room-discussion *{box-sizing:border-box}#ret-room-discussion .rrd-heading{display:flex;justify-content:space-between;align-items:end;gap:16px;padding-bottom:14px;border-bottom:1px solid #e5e5e5}#ret-room-discussion .rrd-eyebrow{margin:0;color:#8d2734;font-size:10px;font-weight:800;letter-spacing:.13em}#ret-room-discussion h2{margin:2px 0 0;font:700 25px/1.2 Georgia,serif}#rrd-count{font-size:12px;color:#626262;white-space:nowrap}#rrd-comments{padding:5px 0 16px}#rrd-comments>.rrd-item{border-bottom:1px solid #eee}#ret-room-discussion .rrd-item{padding:14px 0 8px}#ret-room-discussion .rrd-item .rrd-item{margin-left:clamp(14px,4vw,32px);padding-left:clamp(10px,2vw,18px);border-left:2px solid #e7e1df}#ret-room-discussion .rrd-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:#676767}#ret-room-discussion .rrd-meta strong{color:#252525;font-size:13px}#ret-room-discussion .rrd-badge{padding:1px 6px;border-radius:4px;background:#fff2d9;color:#754d00;font-size:11px}#ret-room-discussion .rrd-body{margin:7px 0 5px;white-space:pre-wrap;overflow-wrap:anywhere}#ret-room-discussion .rrd-actions{display:flex;gap:12px;flex-wrap:wrap}#ret-room-discussion .rrd-actions button,#ret-room-discussion #rrd-cancel{padding:2px 0;border:0;background:transparent;color:#8d2734;font:600 12px system-ui,sans-serif;cursor:pointer}#ret-room-discussion .rrd-actions button:hover,#ret-room-discussion #rrd-cancel:hover{text-decoration:underline}#ret-room-discussion form{margin-top:14px;padding:14px;background:#f8f7f6;border:1px solid #e6e3e1;border-radius:10px}#ret-room-discussion form label{display:block;margin-bottom:7px;font-size:13px;font-weight:700}#ret-room-discussion textarea{width:100%;min-height:78px;padding:10px 12px;resize:vertical;border:1px solid #c9c7c5;border-radius:7px;background:white;color:#202124;font:14px/1.5 system-ui,sans-serif}#ret-room-discussion textarea:focus{outline:2px solid #a93649;outline-offset:1px}#ret-room-discussion .rrd-form-actions{display:flex;justify-content:flex-end;align-items:center;gap:14px;margin-top:8px}#rrd-limit{margin-right:auto;font-size:11px;color:#747474}#ret-room-discussion #rrd-submit{padding:8px 15px;border:0;border-radius:6px;background:#8d2734;color:white;font:700 12px system-ui,sans-serif;cursor:pointer}#ret-room-discussion #rrd-submit:disabled{opacity:.5;cursor:default}#rrd-state{min-height:1.4em;margin:8px 0 0;color:#7e2835;font-size:12px}#ret-room-discussion .rrd-empty{margin:16px 0;color:#666;font-size:13px}@media(max-width:600px){#ret-room-discussion{margin:28px 10px;padding:16px;border-radius:12px}}</style>`;
  const script=`<script id="ret-room-discussion-script">(${client.toString()})(${config});</script>`;
  return html.replace(/<\/body\s*>/i,style+section+script+'</body>');
}

function client(config){
  const root=document.querySelector('#ret-room-discussion');if(!root)return;
  const $=selector=>root.querySelector(selector),list=$('#rrd-comments'),state=$('#rrd-state'),form=$('#rrd-form'),text=$('#rrd-text'),slot=$('#rrd-compose-slot'),label=$('#rrd-form-label'),cancel=$('#rrd-cancel'),submit=$('#rrd-submit'),limit=$('#rrd-limit');
  let editing=null,parentId=null,requestId=crypto.randomUUID(),busy=false;
  const query=new URLSearchParams({page:config.pageId});if(config.roomId)query.set('room',config.roomId);
  async function api(method,body){const r=await fetch('/api/room-discussion?'+query,{method,credentials:'same-origin',headers:method==='POST'?{'Content-Type':'application/json','X-Reading-Room':'1'}:{},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw Error(d.error||'Discussion unavailable.');return d;}
  function button(label,action){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',action);return b;}
  function say(message){state.textContent=message;}
  function reset(){editing=null;parentId=null;text.value='';requestId=crypto.randomUUID();label.textContent='Add your perspective';submit.textContent='Post';cancel.hidden=true;limit.textContent='0 / 1500';slot.append(form);}
  function begin(target,mode,row){editing=mode==='edit'?row.id:null;parentId=mode==='reply'?row.id:null;label.textContent=mode==='edit'?'Edit your comment':'Reply to '+row.name;submit.textContent=mode==='edit'?'Save changes':'Post reply';cancel.hidden=false;text.value=mode==='edit'?row.text:'';limit.textContent=text.value.length+' / 1500';target.append(form);text.focus();}
  async function change(action,row){if(busy)return;busy=true;try{await api('POST',{action,pageId:config.pageId,commentId:row.id});say(action==='delete'?'Comment deleted.':'Comment updated.');reset();await refresh();}catch(e){say(e.message);}finally{busy=false;}}
  function stamp(iso){try{return new Intl.DateTimeFormat(undefined,{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(iso));}catch{return '';}}
  function make(row,children){
    const item=document.createElement('article');item.className='rrd-item';
    const meta=document.createElement('div');meta.className='rrd-meta';const name=document.createElement('strong');name.textContent=row.name||'Room member';const time=document.createElement('time');time.dateTime=row.createdAt;time.textContent=stamp(row.createdAt);meta.append(name,time);
    if(row.status!=='approved'){const badge=document.createElement('span');badge.className='rrd-badge';badge.textContent=row.status==='pending'?'Awaiting approval':'Hidden';meta.append(badge);}
    const body=document.createElement('p');body.className='rrd-body';body.textContent=row.text;
    const actions=document.createElement('div');actions.className='rrd-actions';
    if(row.status==='approved')actions.append(button('Reply',()=>begin(item,'reply',row)));
    if(row.canEdit){actions.append(button('Edit',()=>begin(item,'edit',row)),button('Delete',()=>change('delete',row)));}
    if(row.canModerate){if(row.status!=='approved')actions.append(button('Approve',()=>change('approve',row)));if(row.status!=='hidden')actions.append(button('Hide',()=>change('hide',row)));}
    item.append(meta,body,actions);
    for(const child of children.get(row.id)||[])item.append(make(child,children));
    return item;
  }
  async function refresh(){try{const data=await api('GET');const rows=data.comments||[],children=new Map();for(const row of rows){const key=row.parentId||'';if(!children.has(key))children.set(key,[]);children.get(key).push(row);}list.replaceChildren();for(const row of children.get('')||[])list.append(make(row,children));if(!rows.length){const empty=document.createElement('p');empty.className='rrd-empty';empty.textContent='No comments yet. Start the discussion.';list.append(empty);}$('#rrd-count').textContent=rows.length+' '+(rows.length===1?'comment':'comments');}catch(e){say(e.message);}}
  text.addEventListener('input',()=>{limit.textContent=text.value.length+' / 1500';});
  cancel.addEventListener('click',reset);
  form.addEventListener('submit',async event=>{event.preventDefault();if(busy)return;const value=text.value.trim();if(value.length<2||value.length>1500){say('Use 2 to 1,500 characters.');return;}busy=true;submit.disabled=true;try{const d=editing?await api('POST',{action:'edit',pageId:config.pageId,commentId:editing,text:value}):await api('POST',{action:'post',pageId:config.pageId,parentId,text:value,requestId});say(d.pending?'Saved for room owner approval.':'Posted to the room.');reset();await refresh();}catch(e){say(e.message);}finally{busy=false;submit.disabled=false;}});
  const canRefresh=()=>!busy&&!editing&&!parentId&&!text.value.trim();
  const refreshIfReady=()=>{if(document.visibilityState==='visible'&&canRefresh())refresh();};
  document.addEventListener('visibilitychange',refreshIfReady);
  setInterval(refreshIfReady,20000);
  refresh();
}
