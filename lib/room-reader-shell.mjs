const $ = id => document.getElementById(id);
const state = { rooms: [], activeRoom: null, member: null, articles: [], shelfPublisher: '', searchRoom: null, installPrompt: null };
let headlineSearchRequest=0,urlArticleRequest=0;
const authHeaders = { 'X-Reading-Room': '1' };
function status(id, message = '') { $(id).textContent = message; }
function open(id) { const dialog = $(id); if (!dialog.open) dialog.showModal(); }
function close(id) { $(id).close(); }
function safeHttp(value) { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function sharedArticle(params) {
  let url = params.get('url') || (params.get('text') || '').match(/https?:\/\/\S+/)?.[0] || '';
  let title = params.get('title') || '';
  const bundled = params.get('article');
  if (bundled && bundled.length <= 4096) {
    try {
      const item = JSON.parse(bundled);
      if (typeof item?.url === 'string' && typeof item?.title === 'string') { url = item.url; title = item.title; }
    } catch {}
  }
  url = typeof url === 'string' && url.length <= 2048 ? safeHttp(url) : '';
  title = title.trim();
  if (title.length < 15 || title.length > 400 || /[<>]|https?:\/\//i.test(title)) title = '';
  return { url, title };
}
function shortDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC', ...(date.getUTCFullYear()!==new Date().getUTCFullYear()?{year:'numeric'}:{}) }).format(date); }
function readableError(data, fallback) { return typeof data?.error === 'string' ? data.error : fallback; }
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { ...authHeaders, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  let data = {};
  try { data = await response.json(); } catch {}
  if (response.status === 401) { const next = location.pathname === '/study' ? location.pathname + location.search : '/study'; location.assign('/room?next=' + encodeURIComponent(next)); throw new Error('Please sign in to continue.'); }
  if (!response.ok) throw Object.assign(new Error(readableError(data, 'Please try again.')), {needsHeadline:data.needsHeadline===true,needsLibrarySearch:data.needsLibrarySearch===true,libraryPublisher:data.libraryPublisher,errorCode:data.errorCode,usage:data.usage});
  return data;
}
function post(path, body) { return api(path, { method: 'POST', body: JSON.stringify(body) }); }
function setBusy(button, busy) { button.disabled = busy; button.setAttribute('aria-busy', String(busy)); }
function articleCard(article) {
  const a = document.createElement('a'); a.className = 'article'; a.href = '/read/' + encodeURIComponent(article.id) + (state.activeRoom?.id ? '?room=' + encodeURIComponent(state.activeRoom.id) : '');
  const image = safeHttp(article.image);
  if (image) { const img = document.createElement('img'); img.className = 'article-image'; img.src = image; img.loading = 'lazy'; img.alt = ''; img.referrerPolicy = 'no-referrer'; a.append(img); }
  const body = document.createElement('div'); body.className = 'article-body';
  const source = document.createElement('div'); source.className = 'article-source'; source.textContent = article.publisher || (safeHttp(article.sourceURL) ? new URL(article.sourceURL).hostname.replace(/^www\./, '') : 'Article');
  const title = document.createElement('h3'); title.textContent = article.title || 'Untitled article';
  const footer = document.createElement('div'); footer.className = 'article-footer';
  const date = document.createElement('span'); const addedDate = shortDate(article.createdAt); date.textContent = addedDate ? 'Added ' + addedDate : '';
  const comments = document.createElement('span'); const n = Number(article.commentCount) || 0; comments.textContent = n + (n === 1 ? ' comment' : ' comments');
  footer.append(date, comments); body.append(source, title, footer); a.append(body); return a;
}
function drawShelf() {
  const papers=[...new Set(state.articles.map(article=>article.publisher||'Article'))].sort((a,b)=>a.localeCompare(b));
  if(!papers.includes(state.shelfPublisher))state.shelfPublisher='';
  const selector=$('shelf-paper'),options=['',...papers].map(paper=>{const option=document.createElement('option');option.value=paper;option.textContent=paper||'All newspapers';option.selected=paper===state.shelfPublisher;return option;});
  selector.replaceChildren(...options);$('shelf-filter-wrap').hidden=papers.length<2;
  const visible=state.articles.filter(article=>!state.shelfPublisher||(article.publisher||'Article')===state.shelfPublisher);
  $('cards').replaceChildren(...visible.map(articleCard));
  $('cards').hidden = !visible.length;
  $('empty').hidden = !!state.articles.length;
  $('article-count').textContent = state.articles.length ? '· '+(state.shelfPublisher?visible.length+' of ':'')+state.articles.length : '';
}
function applyRoom() {
  const room = state.activeRoom;
  if(state.searchRoom!==room?.id){state.searchRoom=room?.id;headlineSearchRequest++;$('search-results').replaceChildren();setBusy($('search-submit'),false);}
  $('room-name').textContent = room?.name || 'Reading Room';
  $('people-open').hidden = room?.role !== 'owner';
  $('owner-settings').hidden = room?.role !== 'owner';
  $('create-room-wrap').hidden = !state.member;
  $('rename-name').value = room?.name || '';
  $('moderation').value = room?.moderation === 'approval' ? 'approval' : 'open';
  $('account-name').textContent = state.member?.displayName || state.member?.display_name || 'Signed in';
}
async function load() {
  status('page-status');
  try {
    const rooms = await api('/api/rooms');
    state.rooms = Array.isArray(rooms.rooms) ? rooms.rooms : [];
    state.activeRoom = rooms.activeRoom || null;
    state.member = rooms.member || null;
    applyRoom();
    if (!state.activeRoom) { state.articles = []; drawShelf(); status('page-status', 'Choose or create a room to begin.'); return; }
    const shelf = await api('/api/room-articles');
    state.articles = Array.isArray(shelf.articles) ? shelf.articles : [];
    if (shelf.room) state.activeRoom = { ...state.activeRoom, ...shelf.room };
    applyRoom(); drawShelf();if($('add-dialog').open)loadImportAllowance();
  } catch (error) {
    $('cards').replaceChildren(); $('cards').hidden = true; $('empty').hidden = true;
    status('page-status', error.message || 'Could not load the room.');
  }
}
function setAddTab(tab) {
  const url = tab === 'url';
  $('url-tab').setAttribute('aria-selected', String(url));
  $('search-tab').setAttribute('aria-selected', String(!url));
  $('url-panel').hidden = !url; $('search-panel').hidden = url;
  status('add-status');
  (url ? $('article-url') : $('publisher')).focus();
}
let allowanceRequest=0;
function showImportAllowance(usage) {
  const valid=usage&&Number.isInteger(usage.limit)&&usage.limit>0&&usage.limit<=10000&&Number.isInteger(usage.remaining)&&usage.remaining>=0&&usage.remaining<=usage.limit&&Number.isFinite(Date.parse(usage.resetsAt));
  $('import-allowance').hidden=!valid;if(!valid)return;
  const reset=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Europe/London'}).format(new Date(usage.resetsAt));
  const pending=Number.isInteger(usage.pending)&&usage.pending>=0?usage.pending:0;
  $('import-allowance-summary').textContent=`New study editions: ${usage.remaining} of ${usage.limit} left today.${pending?' '+pending+' being prepared.':''} Resets ${reset} UK time.`;
  const transition=$('import-allowance-transition');
  if(transition){transition.hidden=usage.historyStatus!=='earlier-completions-unavailable';transition.textContent=transition.hidden?'':'The completed-edition counter started today. Earlier attempts were kept separately because they do not show which editions succeeded.';}
}
async function loadImportAllowance(){
  const ticket=++allowanceRequest,room=state.activeRoom?.id;$('import-allowance').hidden=true;
  try{const data=await api('/api/room-usage'+(room?'?room='+encodeURIComponent(room):''));if(ticket===allowanceRequest&&state.activeRoom?.id===room)showImportAllowance(data.usage);}catch{}
}
function openAdd() { urlArticleRequest++;headlineSearchRequest++;setBusy($('url-submit'),false);setBusy($('search-submit'),false);$('source-headline-wrap')?.remove(); open('add-dialog'); setAddTab('url');loadImportAllowance(); }
function showSourceHeadline(url,title=''){
  let wrap=$('source-headline-wrap');
  if(!wrap){wrap=document.createElement('div');wrap.id='source-headline-wrap';const label=document.createElement('label');label.className='field';label.htmlFor='source-headline';label.textContent='Newspaper headline';const input=document.createElement('input');input.id='source-headline';input.className='text-input';input.maxLength=400;input.autocomplete='off';wrap.append(label,input);$('url-submit').before(wrap);}
  const input=$('source-headline');if(input.dataset.url!==url)input.value='';input.dataset.url=url;if(title)input.value=title;
  return input;
}
const recoveryDiscoveryStopwords=new Set('a an and are as at be been being behind but by can could did do does for from had has have he her hers him his how i if in into is it its may might more most must no nor not of on or our out over she should so some than that the their them then there these they this those through to too under up us was we were what when where which who why will with without would you your'.split(' '));
function libraryRecoveryFromURL(raw,allowShort=false,expectedPublisher=''){
  let url;try{url=new URL(raw);}catch{return null;}
  if(raw.length>2048||url.protocol!=='https:'||url.username||url.password||url.port||url.hash||[...url.searchParams.keys()].some(key=>/token|auth|password|passcode|pin|session|credential|secret|key|signature|bearer|card|cookie|borrower|account|email|login|redirect|destination|ticket|nonce|csrf|(?:^|_)code/i.test(key)))return null;
  const host=url.hostname.replace(/^www\./,''),patterns={
    'thetimes.com':['times',/^\/(?:[a-z0-9-]+\/)+article\/([a-z0-9-]+)-[a-z0-9]{9}\/?$/i],
    'telegraph.co.uk':['telegraph',/^\/[a-z0-9-]+\/\d{4}\/\d{2}\/\d{2}\/([a-z0-9-]+)\/?$/i],
    'observer.co.uk':['observer',/^\/news\/(?:[a-z0-9-]+\/)+article\/([a-z0-9-]+)\/?$/i],
    'heraldscotland.com':['herald',/^\/news\/\d{6,12}\.([a-z0-9-]+)\/?$/i],
    'thenational.scot':['national',/^\/news\/\d{6,12}\.([a-z0-9-]+)\/?$/i],
    'irishtimes.com':['irish-times',/^\/(?:[a-z0-9-]+\/)+\d{4}\/\d{2}\/\d{2}\/([a-z0-9-]+)\/?$/i],
    'express.co.uk':['express',/^\/(?:[a-z0-9-]+\/){1,3}\d{5,12}\/([a-z0-9-]+)\/?$/i],
    'dailyrecord.co.uk':['record',/^\/news\/[a-z0-9-]+\/([a-z0-9-]+)-\d{6,12}\/?$/i],
    'sundaypost.com':['sundaypost',/^\/fp\/([a-z0-9-]+)\/?$/i]
  },pattern=patterns[host];if(!pattern)return null;
  const slug=url.pathname.match(pattern[1])?.[1];if(!slug||slug.length>300)return null;
  // The pathname patterns omit date segments, Express/Newsquest numeric IDs
  // the Record numeric ID and the Times nine-character record suffix. Query values are never read.
  const terms=slug.toLowerCase().split('-');if(terms.some(term=>!term||/^\d{6,}$/.test(term)||/^(?=.*[a-z])(?=.*\d)[a-z\d]{8,}$/.test(term)))return null;
  const options=[...$('publisher').querySelectorAll('option')];
  if(!options.some(option=>option.value===pattern[0]&&(option.hasAttribute('data-library-search')||expectedPublisher===pattern[0]&&option.hasAttribute('data-library-fallback'))))return null;
  if(expectedPublisher===pattern[0]&&['record','sundaypost'].includes(pattern[0])&&options.some(option=>option.value===pattern[0]&&option.hasAttribute('data-library-fallback'))){
    const distinct=[...new Set(terms.filter(term=>/^[a-z][a-z0-9]{1,}$/.test(term)&&!recoveryDiscoveryStopwords.has(term)))],query=distinct.slice(0,3).join(' ');
    return distinct.length>=3&&query.length<=240?{publisher:pattern[0],query}:allowShort?{publisher:pattern[0],query:''}:null;
  }
  const query=terms.join(' ');if(query.length>240)return null;
  if(terms.filter(term=>/^[a-z]{2,}$/.test(term)).length<5)return allowShort?{publisher:pattern[0],query:''}:null;
  return {publisher:pattern[0],query};
}
async function recoverLibraryChoices(safe,{room,ticket,searchTicket,sourceHeadline='',expectedPublisher=''}){
  const recovery=libraryRecoveryFromURL(safe,Boolean(expectedPublisher),expectedPublisher),current=()=>ticket===urlArticleRequest&&state.activeRoom?.id===room&&$('add-dialog').open&&$('article-url').value.trim()===safe;
  if(!recovery||expectedPublisher&&recovery.publisher!==expectedPublisher||!room||!current()||headlineSearchRequest!==searchTicket)return false;
  const hint=typeof sourceHeadline==='string'?sourceHeadline.replace(/\s+/g,' ').trim():'';
  if(expectedPublisher&&hint.length>=4&&hint.length<=240&&!/[<>\u0000-\u001f\u007f]|https?:\/\//i.test(hint)&&(hint.match(/\p{L}[\p{L}\p{N}’'-]*/gu)||[]).length>=2)recovery.query=hint;
  const forceLibrary=Boolean(expectedPublisher&&$('publisher').querySelector('option[value="'+recovery.publisher+'"]')?.hasAttribute('data-library-fallback'));
  if(!recovery.query&&forceLibrary){setAddTab('url');showSourceHeadline(safe).focus();status('add-status','Paste the newspaper’s headline to check Camden.');return true;}
  showSourceHeadline(safe);setAddTab('search');
  $('publisher').querySelector('option[value="'+recovery.publisher+'"]').selected=true;
  $('headline').value=recovery.query;$('headline').focus();
  if(!recovery.query){status('add-status','Enter a few words from the headline.');return true;}
  const unchanged=()=>current()&&$('search-tab').getAttribute('aria-selected')==='true'&&$('publisher').value===recovery.publisher&&$('headline').value.trim()===recovery.query;
  const outcome=await search({preventDefault(){}},{recoveryCurrent:unchanged,forceLibrary,expectedPublisher,expectedURL:safe});
  if(outcome&&unchanged()&&!outcome.count){setAddTab('url');showSourceHeadline(safe).focus();status('add-status',outcome.failed?'Camden search could not finish. Paste the newspaper’s headline to retry.':'No Camden choices found from the link. Paste the newspaper’s headline to retry.');}
  return true;
}
async function addArticle(url, button, tryOriginal=false, sourceHeadline='') {
  const safe = safeHttp(url);
  if (!safe) { status('add-status', 'Enter an http or https article link.'); return; }
  const room=state.activeRoom?.id,ticket=++urlArticleRequest,searchTicket=headlineSearchRequest,enteredURL=$('article-url').value,enteredTab=$('url-tab').getAttribute('aria-selected');
  const enteredSourceText=$('source-headline')?.dataset.url===safe?$('source-headline').value:null;
  const sourceTextUnchanged=()=>($('source-headline')?.dataset.url===safe?$('source-headline').value:null)===enteredSourceText;
  setBusy(button, true); status('add-status', 'Adding article…');
  try {
    const recovery=$('source-headline');
    if(!sourceHeadline&&recovery?.dataset.url===safe)sourceHeadline=recovery.value.trim();
    const result = await post('/api/room-articles', { url: safe, tryOriginal, sourceHeadline, requestId: crypto.randomUUID() });
    if(ticket!==urlArticleRequest||state.activeRoom?.id!==room||$('article-url').value!==enteredURL)return;
    if(!sourceTextUnchanged()){status('add-status','Headline changed. Tap Add to room to use it.');return;}
    if(result.needsChoice){let choices=$('url-matches');if(!choices){choices=document.createElement('div');choices.id='url-matches';$('url-panel').append(choices);}choices.replaceChildren();for(const candidate of result.candidates||[]){const link=document.createElement('a');link.className='result-item';link.href=candidate.href;link.textContent=candidate.title;choices.append(link);}const original=document.createElement('button');original.type='button';original.textContent='Try the pasted link instead';original.onclick=()=>addArticle(safe,original,true);choices.append(original);status('add-status','Possible saved articles. Choose one, or try the exact link.');return;}
    $('url-matches')?.remove();$('source-headline-wrap')?.remove();close('add-dialog');
    await load();
    status('page-status', result.cached ? 'Article is already on the shelf.' : 'Article added to the shelf.');
    $('article-url').value = '';
    if(typeof result.href==='string'){
      const destination=new URL(result.href,location.origin);
      if(destination.origin===location.origin&&/^\/read\/[a-z0-9]+$/i.test(destination.pathname))location.assign(destination.pathname+destination.search);
    }
  } catch (error) {
    if(ticket!==urlArticleRequest||state.activeRoom?.id!==room||$('article-url').value!==enteredURL||headlineSearchRequest!==searchTicket||$('url-tab').getAttribute('aria-selected')!==enteredTab)return;
    if(!sourceTextUnchanged()){status('add-status','Headline changed. Tap Add to room to use it.');return;}
    if(error.usage)showImportAllowance(error.usage);else loadImportAllowance();
    if(error.needsLibrarySearch&&typeof error.libraryPublisher==='string'&&error.libraryPublisher&&await recoverLibraryChoices(safe,{room,ticket,searchTicket,sourceHeadline,expectedPublisher:error.libraryPublisher}))return;
    if(error.needsHeadline){
      if(!sourceHeadline&&await recoverLibraryChoices(safe,{room,ticket,searchTicket}))return;
      setAddTab('url');$('article-url').value=safe;
      showSourceHeadline(safe).focus();
      status('add-status','Paste the newspaper’s headline to check Camden.');
    }else status('add-status', error.message);
  }
  finally { if(ticket===urlArticleRequest)setBusy(button, false); }
}
function searchResult(result) {
  const url = safeHttp(result.url);
  if (!url) return null;
  const button = document.createElement('button'); button.type = 'button'; button.className = 'result-item';
  const title = document.createElement('strong'); title.textContent = result.title || url;
  const source = document.createElement('small'); source.textContent = (result.publisher || new URL(url).hostname)+(result.saved?' · On your shelf':'')+(result.basis?.includes('similarity')?' · Similar headline':'');
  button.append(title, source);
  button.addEventListener('click', () => addArticle(url, button, false, result.title==='Supplied article link'?'':result.title||''));
  return button;
}
async function addLibraryRecord(choiceId,button){
  const room=state.activeRoom?.id;if(!room)return;
  setBusy(button,true);status('add-status','Adding Camden article…');
  try{
    const result=await post('/api/library-search/import?room='+encodeURIComponent(room),{choiceId,requestId:crypto.randomUUID()});
    if(state.activeRoom?.id!==room)return;
    close('add-dialog');$('search-results').replaceChildren();await load();
    if(state.activeRoom?.id!==room)return;
    status('page-status',result.cached?'Article is already on the shelf.':'Article added to the shelf.');
    const destination=new URL(result.href,location.origin);
    if(destination.origin===location.origin&&/^\/read\/[a-z0-9]+$/i.test(destination.pathname)&&destination.searchParams.get('room')===room)location.assign(destination.pathname+destination.search);
  }catch(error){if(state.activeRoom?.id===room){if(error.usage)showImportAllowance(error.usage);else loadImportAllowance();status('add-status',error.message);}}
  finally{setBusy(button,false);}
}
function librarySearchResult(result){
  if(!/^[a-f0-9]{48}$/.test(result.choiceId||'')||typeof result.title!=='string'||typeof result.publication!=='string')return null;
  const row=document.createElement('button');row.type='button';row.className='result-item library-result';row.dataset.choiceId=result.choiceId;row.addEventListener('click',()=>addLibraryRecord(result.choiceId,row));
  const title=document.createElement('strong');title.textContent=result.title;
  const source=document.createElement('small');source.textContent='Camden · '+result.publication+' · '+shortDate(result.date);
  row.append(title,source);return row;
}
async function search(event,{recoveryCurrent=null,forceLibrary=false,expectedPublisher='',expectedURL=''}={}) {
  event.preventDefault();
  const button = $('search-submit'); setBusy(button, true); status('add-status', 'Searching…'); $('search-results').replaceChildren();
  const room=state.activeRoom?.id,ticket=++headlineSearchRequest;
  try {
    const publisher=$('publisher').value,headline=$('headline').value.trim(),option=[...$('publisher').querySelectorAll('option')].find(option=>option.value===publisher);
    const forced=forceLibrary===true&&typeof recoveryCurrent==='function'&&recoveryCurrent()&&expectedPublisher===publisher&&$('article-url').value.trim()===expectedURL&&option?.hasAttribute('data-library-fallback')&&libraryRecoveryFromURL(expectedURL,true,expectedPublisher)?.publisher===publisher;
    if(forceLibrary&&(!forced||httpsLink(headline)))return;
    const library=(option?.hasAttribute('data-library-search')||forced)&&!httpsLink(headline);
    const data = library?await post('/api/library-search'+(room?'?room='+encodeURIComponent(room):''),{publisher,query:headline}):await post('/api/article-search',{publisher,headline});
    if(ticket!==headlineSearchRequest||state.activeRoom?.id!==room||recoveryCurrent&&!recoveryCurrent())return;
    const results = (Array.isArray(data.results) ? data.results : []).map(library?librarySearchResult:searchResult).filter(Boolean);
    $('search-results').replaceChildren(...results);
    if(library){status('add-status',results.length?'Choose a Camden article to add.':'No matching Camden headlines found. Try different words.');return {count:results.length};}
    status('add-status', (results.length ? (data.results.some(result => result.supplied) ? 'Supplied link ready. Choose it to try adding the article.' : 'Choose an article to add.') : 'No matching indexed articles found. Try different words or paste a link.') + (data.warning ? ' ' + data.warning : ''));
  } catch (error) { if(ticket===headlineSearchRequest&&state.activeRoom?.id===room&&(!recoveryCurrent||recoveryCurrent())){status('add-status', error.message);return {count:0,failed:true};} }
  finally { if(ticket===headlineSearchRequest)setBusy(button, false); }
}
function httpsLink(value){return /https?:\/\//i.test(value);}
function drawRooms() {
  $('room-list').replaceChildren();
  for (const room of state.rooms) {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'room-item' + (room.id === state.activeRoom?.id ? ' active' : '');
    const title = document.createElement('strong'); title.textContent = room.name;
    const meta = document.createElement('small'); meta.textContent = room.role === 'owner' ? 'Owner' : 'Member';
    item.append(title, meta);
    item.addEventListener('click', async () => { if (room.id === state.activeRoom?.id) { close('rooms-dialog'); return; } setBusy(item, true); try { await post('/api/rooms', { action: 'switch', roomId: room.id }); close('rooms-dialog'); await load(); } catch (error) { status('rooms-status', error.message); } finally { setBusy(item, false); } });
    $('room-list').append(item);
  }
  if (!state.rooms.length) status('rooms-status', 'No rooms yet. Make one below.');
}
function openRooms() { drawRooms(); status('rooms-status'); open('rooms-dialog'); }
async function loadPeople() {
  $('people-list').replaceChildren(); status('people-status', 'Loading members…');
  try {
    const data = await api('/api/member-auth?action=admin');
    const members = Array.isArray(data.members) ? data.members : [];
    for (const member of members) {
      if (member.revoked_at || member.revokedAt) continue;
      const row = document.createElement('div'); row.className = 'member-item split';
      const text = document.createElement('div'); const name = document.createElement('strong'); name.textContent = member.displayName || member.display_name || 'Member';
      const role = document.createElement('small'); role.textContent = member.role === 'owner' ? 'Owner' : 'Member'; text.append(name, role); row.append(text);
      if (member.role !== 'owner') {
        const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'small-btn danger'; revoke.textContent = 'Remove'; let armed = false;
        revoke.addEventListener('click', async () => { if (!armed) { armed = true; revoke.textContent = 'Confirm remove'; return; } setBusy(revoke, true); try { await post('/api/member-auth?action=revoke-member', { memberId: member.id }); await loadPeople(); status('people-status', 'Member removed.'); } catch (error) { status('people-status', error.message); setBusy(revoke, false); } }); row.append(revoke);
      }
      $('people-list').append(row);
    }
    status('people-status', members.length ? '' : 'No members yet.');
  } catch (error) { status('people-status', error.message); }
}
function openPeople() { if (state.activeRoom?.role !== 'owner') return; $('invite-wrap').hidden = true; open('people-dialog'); loadPeople(); }
function showInstall() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  $('install-button').hidden = !state.installPrompt;
  $('install-steps').hidden = !!state.installPrompt;
  if (!state.installPrompt) $('install-steps').textContent = ios ? 'In Safari, tap Share, then Add to Home Screen.' : 'Open your browser menu and choose Install app or Add to Home screen.';
  open('install-dialog');
}
const roomAddress = $('account-room-address');
if (roomAddress) {
  const origin = ['https://dayofflondon.com', 'https://www.dayofflondon.com', 'https://legacy.reader.example.org'].includes(location.origin) ? 'https://dayofflondon.com' : location.origin;
  roomAddress.href = origin + '/study';
  roomAddress.textContent = new URL(origin).host + '/study';
}
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));
$('add-open').addEventListener('click', openAdd); $('empty-add').addEventListener('click', openAdd);
$('url-tab').addEventListener('click', () => setAddTab('url')); $('search-tab').addEventListener('click', () => setAddTab('search'));
$('url-form').addEventListener('submit', event => { event.preventDefault(); addArticle($('article-url').value.trim(), $('url-submit')); });
$('search-form').addEventListener('submit', search);
$('room-open').addEventListener('click', openRooms); $('menu-rooms').addEventListener('click', () => { close('menu-dialog'); openRooms(); });
$('people-open').addEventListener('click', openPeople); $('menu-open').addEventListener('click', () => open('menu-dialog'));
$('member-open').addEventListener('click', () => open('account-dialog'));
$('menu-install').addEventListener('click', () => { close('menu-dialog'); showInstall(); });
$('account-install').addEventListener('click', () => { close('account-dialog'); showInstall(); });
$('create-room-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.submitter; setBusy(button, true); try { await post('/api/rooms', { action: 'create', name: $('create-room-name').value.trim() }); close('rooms-dialog'); $('create-room-name').value = ''; await load(); } catch (error) { status('rooms-status', error.message); } finally { setBusy(button, false); } });
$('rename-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.submitter; setBusy(button, true); try { await post('/api/rooms', { action: 'rename', name: $('rename-name').value.trim() }); await load(); status('menu-status', 'Room name saved.'); } catch (error) { status('menu-status', error.message); } finally { setBusy(button, false); } });
$('moderation').addEventListener('change', async event => { const select = event.currentTarget; select.disabled = true; try { await post('/api/rooms', { action: 'moderation', moderation: select.value }); status('menu-status', 'Comment setting saved.'); } catch (error) { status('menu-status', error.message); } finally { select.disabled = false; } });
$('invite-button').addEventListener('click', async () => { const button = $('invite-button'); setBusy(button, true); try { const result = await post('/api/member-auth?action=invite', { purpose: 'member' }); $('invite-link').textContent = result.url; $('invite-wrap').hidden = false; status('people-status', 'Invitation ready to share.'); } catch (error) { status('people-status', error.message); } finally { setBusy(button, false); } });
$('copy-invite').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('invite-link').textContent); status('people-status', 'Link copied.'); } catch { status('people-status', 'Select the link above to copy it.'); } });
$('share-invite').addEventListener('click', async () => { if (!navigator.share) { status('people-status', 'Select and copy the link above to share it.'); return; } try { await navigator.share({ title: 'Reading Room invitation', url: $('invite-link').textContent }); } catch {} });
$('install-button').addEventListener('click', async () => { const prompt = state.installPrompt; if (!prompt) return; state.installPrompt = null; close('install-dialog'); await prompt.prompt(); });
addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; });
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
async function start() {
  const params = new URLSearchParams(location.search);
  const requestedRoom = params.get('room');
  if (requestedRoom) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(requestedRoom)) { $('cards').replaceChildren(); status('page-status', 'That room link is invalid.'); return; }
    try {
      await post('/api/rooms', { action: 'switch', roomId: requestedRoom });
      params.delete('room');
      history.replaceState(null, '', location.pathname + (params.size ? '?' + params.toString() : ''));
    } catch (error) { $('cards').replaceChildren(); status('page-status', error.message); return; }
  }
  await load();
  const shared = sharedArticle(params);
  if (params.get('action') === 'add' || shared.url) {
    openAdd();
    if (shared.url) { $('article-url').value = shared.url; if (shared.title) showSourceHeadline(shared.url, shared.title); }
  }
}
start();

$('shelf-paper').addEventListener('change',()=>{state.shelfPublisher=$('shelf-paper').value;drawShelf();});
