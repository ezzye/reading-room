import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {sourceScopedPublication,sourceScopedLibraryPublication,sourceScopedSearchTerms,sourceScopedSearchForm,sourceScopedSearchFormCheck,sourceScopedRedirectURL,sourceScopedResultsMatch,sourceScopedURLParams} from './newsbank-source-scoped-search.mjs';

const name='Scotsman, The/Scotland on Sunday (Scotland)',t='pubname:SCOPEDTEST!'+new URLSearchParams({n:name}).toString().slice(2);
const browseURL='https://infoweb.newsbank.com/apps/news/browse-pub?p=UKNB&t='+encodeURIComponent(t)+'&action=browse';
const source={name,dates:'1998 - Current',location:'Scotland - Edinburgh',format:'Text',browseURL};
const doc=html=>parseHTML(html).document;
const form=(extra='',action=browseURL)=>'<h1>'+name+'</h1><form method="POST" action="'+action.replaceAll('&','&amp;')+'"><input type="hidden" name="p" value="UKNB"><input type="hidden" name="t" value="'+t+'"><input type="hidden" name="fld-base-0" value="AllText"><input type="hidden" name="sort" value="YMD_date:D"><input type="hidden" name="hide_duplicates" value="2"><input type="hidden" name="maxresults" value="20"><input type="hidden" name="form_id" value="native-search"><input id="edit-val-base-0" name="val-base-0" value="PRIVATE-OLD-QUERY"><input name="submit" type="submit" value="Search">'+extra+'</form>';
const posted=()=>sourceScopedSearchForm(doc(form()),source).fields.map(([key,value])=>[key,key==='val-base-0'?'"Actual query words"':value]);
const resultURL=(fields=posted())=>{const url=new URL('https://infoweb.newsbank.com/apps/news/results');for(const [key,value]of fields)if(['p','t','val-base-0','fld-base-0','sort','maxresults','hide_duplicates'].includes(key))url.searchParams.append(key,value);return url;};

test('scoped human-choice discovery quotes literal words joined by AND without changing publication proof',()=>{
 assert.equal(sourceScopedSearchTerms('John Swinney bus plans'),'"John" AND "Swinney" AND "bus" AND "plans"');assert.equal(sourceScopedSearchTerms('Children’s future, evidence-based choices'),'"Children’s" AND "future" AND "evidence-based" AND "choices"');assert.equal(sourceScopedSearchTerms('"First" OR last'),'"First" AND "OR" AND "last"');
 for(const input of ['',null,'one','PRIVATE\nQUERY','<script>query</script>','word '.repeat(100)])assert.throws(()=>sourceScopedSearchTerms(input));
});

test('only Scotsman metadata uses a fresh observed POST form and preserves the native default field',()=>{
 for(const key of ['scotsman','press-and-journal','record','news-letter','sundaypost'])assert.equal(sourceScopedPublication(key),true);for(const key of ['telegraph','times','observer','ft'])assert.equal(sourceScopedPublication(key),false);
 for(const key of ['scotsman','press-and-journal','news-letter','record','sundaypost'])assert.equal(sourceScopedLibraryPublication(key),true);for(const key of ['ft','morning-star','courier'])assert.equal(sourceScopedLibraryPublication(key),false);
 const plan=sourceScopedSearchForm(doc(form('<input type="hidden" name="form_build_id" value="PRIVATE-NATIVE-NONCE">')),source);assert.equal(plan.destination,browseURL);assert.deepEqual(plan.fields.filter(([key])=>['fld-base-0','sort','hide_duplicates','maxresults','form_id'].includes(key)),[['fld-base-0','AllText'],['sort','YMD_date:D'],['hide_duplicates','2'],['maxresults','20'],['form_id','native-search']]);assert(plan.fields.some(([key,value])=>key==='form_build_id'&&value==='PRIVATE-NATIVE-NONCE'));assert(!plan.fields.some(([key])=>key==='submit'));
});
test('changed source heading, active binding, method, action, query identity or hidden default refuses submission',()=>{
 for(const html of [form().replace('<h1>'+name+'</h1>','<h1>The Times</h1>'),form().replace('value="UKNB"','value="OTHER"'),form('<input name="t" type="hidden" value="pubname:OTHER">'),form('<input name="P" type="hidden" value="UKNB">'),form().replace('method="POST"','method="GET"'),form('',browseURL.replace('SCOPEDTEST','OTHER')),form().replace('id="edit-val-base-0"','id="other"'),form().replace('id="edit-val-base-0"','disabled id="edit-val-base-0"'),form('<input name="val-base-0" id="edit-val-base-0" value="duplicate">'),form().replace('name="fld-base-0"','name="missing"'),form().replace('type="hidden" name="fld-base-0"','type="text" name="fld-base-0"'),form('<input name="password" value="PRIVATE">'),form('<input type="hidden" name="product" value="OTHER">'),form('<input type="hidden" name="p[]" value="OTHER">')])assert.equal(sourceScopedSearchForm(doc(html),source),null);
});
test('the one ordinary results redirect must preserve exact source, query and any returned native defaults',()=>{
 const fields=posted(),url=resultURL(fields);assert.equal(sourceScopedRedirectURL(url.href,source,fields),url.href);
 for(const change of [u=>u.searchParams.delete('t'),u=>u.searchParams.set('t','pubname:OTHER'),u=>u.searchParams.set('p','OTHER'),u=>u.searchParams.delete('val-base-0'),u=>u.searchParams.set('val-base-0','different words'),u=>u.searchParams.set('fld-base-0','Headline'),u=>u.searchParams.append('t',t),u=>u.searchParams.set('docref','news/ABC'),u=>u.searchParams.set('form_build_id','PRIVATE-NONCE'),u=>u.searchParams.set('session','PRIVATE'),u=>u.pathname='/apps/news/document-view',u=>u.hostname='attacker.example',u=>u.username='user',u=>u.hash='private']){const changed=new URL(url);change(changed);assert.equal(sourceScopedRedirectURL(changed.href,source,fields),'');}
});
test('direct or redirected metadata may not retain conflicting active public source controls',()=>{
 const fields=posted();assert.equal(sourceScopedResultsMatch(doc('<div class="search-hits__hit"></div>'),source,browseURL,fields),true);assert.equal(sourceScopedResultsMatch(doc(form()),source,resultURL().href,fields),true);
 for(const extra of ['<input name="t" value="pubname:OTHER">','<input name="p" value="OTHER">','<input name="action" value="other">','<input name="T" value="'+t+'">'])assert.equal(sourceScopedResultsMatch(doc('<form>'+extra+'</form>'),source,browseURL,fields),false);
 assert.equal(sourceScopedResultsMatch(doc('<form><input type="checkbox" name="t" value="pubname:OTHER"><input disabled name="t" value="pubname:OTHER"></form>'),source,browseURL,fields),true);
 assert.equal(sourceScopedResultsMatch(doc('<h1>The Times</h1>'),source,browseURL,fields),false);
});

test('failure diagnostics expose only fixed checks and bounded counts, with no native names, values, URLs or query',()=>{
 const cases=[
  [form()+'<input type="hidden" name="val-base-0" value="PRIVATE-HIDDEN">','global_query_count',{visibleQueryFields:2,eligibleQueryFields:1,candidateQueryFields:1}],
  [form().replace('value="AllText"','value=""'),'default_field',{fldValueState:'empty',defaultFieldCount:1}],
  [form('<input name="native_visible" value="PRIVATE-UNKNOWN-VALUE">'),'successful_fields',{unknownFieldCount:1}],
  [form().replace('value="AllText"','value="'+('PRIVATE'.repeat(30))+'"'),'default_field',{fldValueState:'oversize'}],
  [form().replace('method="POST"','method="GET"'),'form_method',{}]
 ];
 for(const [html,check,expected]of cases){const result=sourceScopedSearchFormCheck(doc(html),source);assert.equal(result.plan,null);assert.equal(result.diagnostic.check,check);for(const [key,value]of Object.entries(expected))assert.equal(result.diagnostic[key],value);assert.doesNotMatch(JSON.stringify(result.diagnostic),/PRIVATE|AllText|pubname|SCOPEDTEST|Scotsman|https|val-base|fld-base|edit-val|form_id/);for(const [key,value]of Object.entries(result.diagnostic))if(key.endsWith('Count')||key.endsWith('Fields')||key.endsWith('Forms'))assert(Number.isInteger(value)&&value>=0&&value<=1000);}
 const large=sourceScopedSearchFormCheck(doc(form()+'<form></form>'.repeat(1100)),source);assert.equal(large.diagnostic.formCount,1000);assert.equal(large.diagnostic.check,'accepted');
});

test('bounded native hidden state returns unchanged only inside the exact source form and never changes source or destination',()=>{
 const privateValue='PRIVATE-NATIVE-OPAQUE-VALUE';
 for(const name of ['native_state','_csrf_token','SESSION_TOKEN','native-token']){const checked=sourceScopedSearchFormCheck(doc(form('<input type="hidden" name="'+name+'" value="'+privateValue+'">')),source);assert(checked.plan);assert(checked.plan.fields.some(([key,value])=>key===name&&value===privateValue));assert.doesNotMatch(JSON.stringify(checked.diagnostic),/PRIVATE|native_state|csrf|SESSION_TOKEN|native-token/);const location=resultURL(checked.plan.fields);location.searchParams.set(name,privateValue);assert.equal(sourceScopedRedirectURL(location.href,source,checked.plan.fields),'');}
 for(const name of ['p[]','p[0]','T[]','P','source_filter','publisherId','collectionName','product','returnUrl','redirect_to','document_id','docref','action','destination','image_url'])assert.equal(sourceScopedSearchForm(doc(form('<input type="hidden" name="'+name+'" value="PRIVATE">')),source),null,name);
 for(const extra of ['<input name="native_state" value="PRIVATE">','<select name="native_state"><option value="PRIVATE">Native</option></select>','<input type="password" name="native_state" value="PRIVATE">','<input type="hidden" name="native_state" value="PRIVATE" form="another-form">','<input type="hidden" name="native_state" value="PRIVATE&#10;CONTROL">','<input type="hidden" name="native_state" value="nonascii£">','<input type="hidden" name="'+('x'.repeat(65))+'" value="PRIVATE">','<input type="hidden" name="native_state" value="'+('x'.repeat(8193))+'">'])assert.equal(sourceScopedSearchForm(doc(form(extra)),source),null);
 assert.equal(sourceScopedSearchForm(doc(form(Array.from({length:41},(_,i)=>'<input type="hidden" name="native_'+i+'" value="PRIVATE">').join(''))),source),null);
 assert.equal(sourceScopedSearchForm(doc(form(Array.from({length:4},(_,i)=>'<input type="hidden" name="native_'+i+'" value="'+('x'.repeat(8000))+'">').join(''))),source),null);
});

test('first refused field diagnostic reveals only a bounded safe control name and fixed structural reason',()=>{
 const failure=extra=>sourceScopedSearchFormCheck(doc(form(extra)),source).diagnostic.firstFieldFailure;
 assert.deepEqual(failure('<input type="hidden" name="source_token" value="PRIVATE-SECRET">'),{reason:'reserved_native_name',tag:'input',type:'hidden',name:'source_token'});
 assert.deepEqual(failure('<input type="password" name="form_token" value="PRIVATE-PASSWORD">'),{reason:'unsupported_type',tag:'input',type:'password',name:'form_token'});
 assert.equal(failure('<select name="native_state"><option>PRIVATE-OPTION</option></select>').type,'select-one');
 for(const [extra,reason]of [['<input type="hidden" name="native_state" value="nonascii£">','non_ascii_native_value'],['<input type="hidden" name="native_state" value="PRIVATE" form="">','form_association'],['<input type="file" name="native_upload">','file_control'],['<input type="PRIVATE-TYPE" name="native_state" value="PRIVATE">','unsupported_type'],['<input type="hidden" name="native_state" value="'+('x'.repeat(8193))+'">','value_too_long']]){const diagnostic=failure(extra);assert.equal(diagnostic.reason,reason);assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE|nonascii|£|x{20}/);}
 for(const name of ['user@example.test','https://private.example/path','native_12345678','abcdef1234567890','x'.repeat(32),'bad<name>']){const diagnostic=failure('<input name="'+name+'" value="PRIVATE-SECRET">');assert.equal(diagnostic.name,'redacted');assert.doesNotMatch(JSON.stringify(diagnostic),/PRIVATE|example|12345678|abcdef|x{20}|bad</);}
});

test('exact r-urlparams keeps only proved public native browse context and safely describes every refused shape',()=>{
 const fields=posted(),context={p:'UKNB',t,action:'browse','fld-base-0':'AllText',sort:'YMD_date:D'},query=new URLSearchParams(context).toString(),attr=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;');
 for(const raw of [query,'?'+query,'https://infoweb.newsbank.com/apps/news/browse-pub?'+query,'/apps/news/browse-pub?'+query,JSON.stringify(context),new URLSearchParams({p:'UKNB',t}).toString(),JSON.stringify({p:'UKNB',t})]){assert.equal(sourceScopedURLParams(raw,source,fields).valid,true);const plan=sourceScopedSearchForm(doc(form('<input type="hidden" name="r-urlparams" value="'+attr(raw)+'">')),source);assert(plan);assert.equal(plan.fields.find(([key])=>key==='r-urlparams')[1],raw);}
 const invalid=[query+'&p=UKNB',query+'&%70=UKNB',query+'&session_token=PRIVATE',query+'&docref=news%2FPRIVATE',query+'&val-base-0=PRIVATE',query.replace('p=UKNB','p=OTHER'),query.replace('action=browse','action=other'),query.replace('SCOPEDTEST','OTHER'),query.replace('AllText','TI'),query+'&unknown=PRIVATE',query+'%GG',encodeURIComponent(query),'https://attacker.example/apps/news/browse-pub?'+query,'https://infoweb.newsbank.com/apps/news/results?'+query,JSON.stringify(context).replace('"p":"UKNB"','"p":"UKNB","\\u0070":"UKNB"'),JSON.stringify({...context,sort:{nested:'PRIVATE'}}),JSON.stringify({...context,sort:1})];
 for(const raw of invalid){const checked=sourceScopedURLParams(raw,source,fields);assert.equal(checked.valid,false,raw);assert.doesNotMatch(JSON.stringify(checked.evidence),/PRIVATE|pubname|SCOPEDTEST|AllText|YMD_date|OTHER|attacker|https|%/);assert.equal(sourceScopedSearchForm(doc(form('<input type="hidden" name="r-urlparams" value="'+attr(raw)+'">')),source),null);}
 for(const name of ['R-URLPARAMS','native_urlparams','returnUrl'])assert.equal(sourceScopedSearchForm(doc(form('<input type="hidden" name="'+name+'" value="'+attr(query)+'">')),source),null);
 const duplicate=form('<input type="hidden" name="r-urlparams" value="'+attr(query)+'"><input type="hidden" name="r-urlparams" value="'+attr(query)+'">');assert.equal(sourceScopedSearchForm(doc(duplicate),source),null);
});
