import test from 'node:test';
import assert from 'node:assert/strict';
import {COLLECTION} from '../extension-library/library-core.mjs';
import {LIBRARY_PUBLICATIONS,libraryPublication,libraryPublicationForURL,matchesLibraryPublication,proveLibraryPublication,knownLibraryPublicationLabel,sourceScopedLibraryLabel,OBSERVER_PUBLICATION_LABEL,HERALD_PUBLICATION_LABEL,NATIONAL_PUBLICATION_LABEL,IRISH_TIMES_PUBLICATION_LABEL,EXPRESS_PUBLICATION_LABEL,SCOTSMAN_PUBLICATION_LABEL,SCOTLAND_ON_SUNDAY_PUBLICATION_LABEL,SCOTSMAN_DOCUMENT_FAMILY_LABEL,libraryDocumentPublicationLabels,knownLibraryDocumentPublicationLabel,matchesLibraryDocumentPublication,proveLibraryDocumentPublication,libraryDocumentPublicationMatchesSelection,PRESS_JOURNAL_PUBLICATION_LABEL,NEWS_LETTER_PUBLICATION_LABEL,DAILY_RECORD_WEB_PUBLICATION_LABEL,SUNDAY_POST_PUBLICATION_LABEL,UKNB_SEARCH_ENTRY} from './library-publications.mjs';
import {libraryArticle} from './library-article-url.mjs';

test('full-text registry contains only source-backed publishers and immutable source policies',()=>{
 assert.deepEqual(Object.keys(LIBRARY_PUBLICATIONS),['times','telegraph','observer','herald','national','irish-times','express','scotsman','press-and-journal','news-letter','record','sundaypost']);
 for(const key of ['constructor','__proto__','guardian','unknown',null,{}])assert.equal(libraryPublication(key),null);
 for(const paper of Object.values(LIBRARY_PUBLICATIONS)){assert(Object.isFrozen(paper));assert(Object.isFrozen(paper.hosts));assert(Object.isFrozen(paper.observedLabels));}
 assert.deepEqual(libraryPublication('times').observedLabels,[]);
 assert.deepEqual(libraryPublication('telegraph').observedLabels,[]);
 assert.deepEqual(libraryPublication('observer').observedLabels,[OBSERVER_PUBLICATION_LABEL]);
 assert.equal(libraryPublication('times').searchEntry,COLLECTION);
 assert.equal(libraryPublication('observer').searchEntry,UKNB_SEARCH_ENTRY);
 assert.equal(libraryPublication('telegraph').datePolicy,'exact-or-next-day');
 assert.equal(libraryPublication('observer').datePolicy,'exact');
 assert.equal(libraryPublication('observer').urlHintMinimumScore,.85);
 for(const key of ['herald','national','irish-times','express','scotsman','press-and-journal','news-letter','record','sundaypost']){assert.equal(libraryPublication(key).urlIntakeEnabled,false);assert.equal(libraryPublication(key).strictPublication,true);assert.equal(libraryPublication(key).datePolicy,'exact');}
});

test('observed Scottish labels enable strict selected-record proof without aliasing or automatic URL intake',()=>{
 for(const [key,label,url] of [['herald',HERALD_PUBLICATION_LABEL,'https://www.heraldscotland.com/news/26644107.watched-bbc-scotland-night-got-sense-doom/'],['national',NATIONAL_PUBLICATION_LABEL,'https://www.thenational.scot/news/26647064.jenny-gilruth-pledges-work-bus-companies-mcgills/']]){
  assert.equal(proveLibraryPublication('Source: '+label,key),label);assert.equal(proveLibraryPublication(label+' extra',key),'');assert.equal(matchesLibraryPublication(key==='herald'?'The Herald':'The National',key),false);
  assert.equal(libraryPublicationForURL(url).key,key);assert.throws(()=>libraryArticle(url),/selected library records only/);
  for(const invalid of [url.replace('https:','http:'),url.replace('/news/','/news/private/'),url+'?session=private',url.replace('www.','user:pass@www.')])assert.throws(()=>libraryPublicationForURL(invalid));
 }
});

test('registry preserves existing Times and Telegraph proof while new labels require exact observed fields',()=>{
 assert.equal(proveLibraryPublication('October 18, 2026 The Sunday Times London','times'),'The Times (Camden NewsBank text edition)');
 assert.equal(proveLibraryPublication('The Daily Telegraph (London, UK)','telegraph'),'The Daily Telegraph (London, UK) (Camden NewsBank text edition)');
 assert.equal(proveLibraryPublication('The Sunday Telegraph (London, UK)','telegraph'),'The Sunday Telegraph (London, UK) (Camden NewsBank text edition)');
 for(const [value,key] of [['The Financial Times','times'],['Telegraph (Sydney, Australia)','telegraph'],['The Observer','observer'],[OBSERVER_PUBLICATION_LABEL+' extra','observer']])assert.equal(proveLibraryPublication(value,key),'');
 assert.equal(proveLibraryPublication('Publication: '+OBSERVER_PUBLICATION_LABEL,'observer'),OBSERVER_PUBLICATION_LABEL);
 assert.deepEqual(knownLibraryPublicationLabel('Source: '+OBSERVER_PUBLICATION_LABEL),{key:'observer',label:OBSERVER_PUBLICATION_LABEL});
 for(const label of ['The Observer','Observer',OBSERVER_PUBLICATION_LABEL+' extra','The Times','Express, Daily'])assert.equal(knownLibraryPublicationLabel(label),null);
 assert.equal(matchesLibraryPublication('The Times (Camden NewsBank text edition)','times'),true);
 assert.equal(matchesLibraryPublication(OBSERVER_PUBLICATION_LABEL,'observer'),true);
});

test('registry URL routing preserves exact publisher identity and refuses unregistered or credential-bearing Observer URLs',()=>{
 const observer='https://observer.co.uk/news/national/article/fictional-archive-funding-plans';
 assert.equal(libraryPublicationForURL(observer).key,'observer');
 assert.equal(libraryPublicationForURL(observer.replace('observer.co.uk','www.observer.co.uk')+'?utm_source=example#top').url,observer);
 assert.equal(libraryPublicationForURL('https://www.telegraph.co.uk/news/2026/10/18/fictional-local-story/').key,'telegraph');
 assert.equal(libraryPublicationForURL('https://www.thetimes.com/uk/politics/article/fictional-local-story-abcdefghi').key,'times');
 for(const url of [observer.replace('https:','http:'),observer.replace('observer.co.uk','observer.co.uk.attacker.example'),observer.replace('/article/','/topic/'),observer+'?session=private','https://www.express.co.uk/news/fictional-story'])assert.throws(()=>libraryPublicationForURL(url));
});

test('Irish Times observed bibliography enables selected search only with the exact qualified label',()=>{
 const paper=libraryPublication('irish-times');assert.equal(paper.name,'The Irish Times');assert.deepEqual(paper.hosts,['irishtimes.com']);assert.deepEqual(paper.observedLabels,[IRISH_TIMES_PUBLICATION_LABEL]);assert.equal(paper.urlIntakeEnabled,false);assert.equal(paper.requireDate,true);assert.equal(paper.searchEntry,UKNB_SEARCH_ENTRY);assert.equal(proveLibraryPublication('Publication: '+IRISH_TIMES_PUBLICATION_LABEL,'irish-times'),IRISH_TIMES_PUBLICATION_LABEL);assert.deepEqual(knownLibraryPublicationLabel(IRISH_TIMES_PUBLICATION_LABEL),{key:'irish-times',label:IRISH_TIMES_PUBLICATION_LABEL});
 for(const value of ['The Irish Times','Irish Times',IRISH_TIMES_PUBLICATION_LABEL+' extra','Irish Times (Dublin, Ireland)',IRISH_TIMES_PUBLICATION_LABEL.replace('Dublin, Ireland','London, England')]){assert.equal(proveLibraryPublication(value,'irish-times'),'');assert.equal(matchesLibraryPublication(value,'irish-times'),false);}
 assert.equal(matchesLibraryPublication(IRISH_TIMES_PUBLICATION_LABEL,'times'),false);assert.equal(proveLibraryPublication(IRISH_TIMES_PUBLICATION_LABEL,'times'),'');for(const url of ['https://www.irishtimes.com/politics/2026/10/18/synthetic-article/','https://irishtimes.com/news/123.synthetic-article/']){assert.throws(()=>libraryPublicationForURL(url));assert.throws(()=>libraryArticle(url));}
});

test('Express uses only the exact observed combined source label for selected library records',()=>{
 const paper=libraryPublication('express');assert.equal(paper.name,'Daily and Sunday Express');assert.equal(paper.urlIntakeEnabled,false);assert.equal(paper.requireDate,true);assert.deepEqual(paper.observedLabels,[EXPRESS_PUBLICATION_LABEL]);assert.equal(proveLibraryPublication('Publication: '+EXPRESS_PUBLICATION_LABEL,'express'),EXPRESS_PUBLICATION_LABEL);assert.deepEqual(knownLibraryPublicationLabel(EXPRESS_PUBLICATION_LABEL),{key:'express',label:EXPRESS_PUBLICATION_LABEL});
 for(const value of ['Express','Daily Express','Sunday Express','The Express','Express, The',EXPRESS_PUBLICATION_LABEL+' extra',EXPRESS_PUBLICATION_LABEL.replace('London, England','Dublin, Ireland')]){assert.equal(matchesLibraryPublication(value,'express'),false);assert.equal(proveLibraryPublication(value,'express'),'');}assert.throws(()=>libraryPublicationForURL('https://www.express.co.uk/news/uk/123456/synthetic-article'));assert.throws(()=>libraryArticle('https://www.express.co.uk/news/uk/123456/synthetic-article'));
});

test('Scotsman selected records retain the actual observed daily or Sunday publication without URL or unobserved aliases',()=>{
 const policy=libraryPublication('scotsman');assert.equal(policy.selectedSearchMode,'native-source-scoped');assert.equal(policy.urlIntakeEnabled,false);assert.equal(policy.requireDate,true);assert.deepEqual(policy.observedLabels,[SCOTSMAN_PUBLICATION_LABEL,SCOTLAND_ON_SUNDAY_PUBLICATION_LABEL]);
 for(const label of policy.observedLabels){assert.equal(proveLibraryPublication('Source: '+label,'scotsman'),label);assert.deepEqual(knownLibraryPublicationLabel(label),{key:'scotsman',label});}
 for(const label of ['The Scotsman','Scotsman','Scotland on Sunday','Scotsman, The (Glasgow, Scotland)',SCOTSMAN_PUBLICATION_LABEL+' extra','Scotsman, The/Scotland on Sunday (Scotland)']){assert.equal(proveLibraryPublication(label,'scotsman'),'');assert.equal(matchesLibraryPublication(label,'scotsman'),false);}
 assert.throws(()=>libraryPublicationForURL('https://www.scotsman.com/news/synthetic-story'));assert.throws(()=>libraryArticle('https://www.scotsman.com/news/synthetic-story'));
 for(const key of ['ft','morning-star','courier'])assert.equal(libraryPublication(key),null);
});

test('observed Scottish and Northern Irish source metadata enable only exact selected library records',()=>{
 for(const [key,label,host]of [['press-and-journal',PRESS_JOURNAL_PUBLICATION_LABEL,'pressandjournal.co.uk'],['news-letter',NEWS_LETTER_PUBLICATION_LABEL,'newsletter.co.uk'],['record',DAILY_RECORD_WEB_PUBLICATION_LABEL,'dailyrecord.co.uk'],['sundaypost',SUNDAY_POST_PUBLICATION_LABEL,'sundaypost.com']]){const policy=libraryPublication(key);assert.equal(policy.selectedSearchMode,'native-source-scoped');assert.equal(policy.urlIntakeEnabled,false);assert.equal(policy.strictPublication,true);assert.equal(policy.requireDate,true);assert.deepEqual(policy.observedLabels,[label]);assert.equal(proveLibraryPublication('Publication: '+label,key),label);assert.equal(sourceScopedLibraryLabel(label),label);assert.equal(matchesLibraryPublication(label+' extra',key),false);assert.equal(proveLibraryPublication(label.replace('Scotland','England').replace('Northern Ireland','England'),key),'');assert.throws(()=>libraryPublicationForURL('https://'+host+'/news/synthetic-story'));}
 assert.equal(sourceScopedLibraryLabel(OBSERVER_PUBLICATION_LABEL),'');assert.equal(sourceScopedLibraryLabel('Press and Journal (Aberdeen, Scotland)'),'');assert.equal(sourceScopedLibraryLabel('News Letter'),'');
});

test('the observed Scotsman document-family label is directional document proof and never a search-choice alias',()=>{
 const family=SCOTSMAN_DOCUMENT_FAMILY_LABEL,daily=SCOTSMAN_PUBLICATION_LABEL,sunday=SCOTLAND_ON_SUNDAY_PUBLICATION_LABEL;
 assert(Object.isFrozen(libraryDocumentPublicationLabels('scotsman')));assert.equal(matchesLibraryDocumentPublication(family,'scotsman'),true);assert.equal(proveLibraryDocumentPublication('Publication: '+family,'scotsman'),family);assert.deepEqual(knownLibraryDocumentPublicationLabel(family),{key:'scotsman',label:family});
 assert.equal(proveLibraryPublication(family,'scotsman'),'');assert.equal(matchesLibraryPublication(family,'scotsman'),false);assert.equal(knownLibraryPublicationLabel(family),null);assert.equal(sourceScopedLibraryLabel(family),'');
 for(const choice of [daily,sunday]){assert.equal(libraryDocumentPublicationMatchesSelection(family,choice,'scotsman'),true);assert.equal(libraryDocumentPublicationMatchesSelection(choice,choice,'scotsman'),true);assert.equal(libraryDocumentPublicationMatchesSelection(choice,family,'scotsman'),false);}
 for(const [actual,choice] of [[daily,sunday],[sunday,daily],[family,family],[family+' extra',daily],[family.replace('Scotland','England'),sunday],['The Scotsman',daily]])assert.equal(libraryDocumentPublicationMatchesSelection(actual,choice,'scotsman'),false);
 for(const key of Object.keys(LIBRARY_PUBLICATIONS).filter(key=>key!=='scotsman')){assert.equal(proveLibraryDocumentPublication(family,key),'');assert.equal(libraryDocumentPublicationMatchesSelection(family,LIBRARY_PUBLICATIONS[key].observedLabels[0],key),false);}
 assert.equal(libraryDocumentPublicationMatchesSelection('The Times (Camden NewsBank text edition)','The Times (Camden NewsBank text edition)','times'),true);
});
