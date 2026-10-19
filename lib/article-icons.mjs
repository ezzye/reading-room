import {parseHTML} from 'linkedom/worker';

// Reading Room's own letter badges, not publisher-supplied logos. Only this
// fixed catalogue can choose a public asset; article data never becomes SVG.
export const ARTICLE_ICON_PROFILES = [
 ['times','T','#080817',['thetimes.com','thetimes.co.uk'],['The Times','The Sunday Times']],
 ['telegraph','T','#00635a',['telegraph.co.uk'],['The Telegraph','The Daily Telegraph','The Sunday Telegraph']],
 ['guardian','G','#052962',['theguardian.com'],['The Guardian']],
 ['observer','O','#17332f',['observer.co.uk'],['The Observer','Observer, The']],
 ['bbc','BBC','#b80000',['bbc.co.uk','bbc.com'],['BBC News']],
 ['independent','I','#ce0000',['independent.co.uk'],['The Independent']],
 ['standard','S','#dc102d',['standard.co.uk'],['The Standard','Evening Standard','London Evening Standard']],
 ['metro','M','#0055a6',['metro.co.uk'],['Metro']],
 ['mirror','M','#e1251b',['mirror.co.uk'],['Daily Mirror','Sunday Mirror']],
 ['star','DS','#ed1c24',['dailystar.co.uk'],['Daily Star','Daily Star Sunday']],
 ['record','DR','#e62020',['dailyrecord.co.uk'],['Daily Record','Daily Record / Sunday Mail','Daily Record, The / Sunday Mail']],
 ['sun','S','#ed1c24',['thesun.co.uk'],['The Sun','The Sun on Sunday']],
 ['mail','DM','#004db3',['dailymail.com','dailymail.co.uk'],['Daily Mail','The Mail on Sunday','Mail on Sunday']],
 ['express','E','#194c83',['express.co.uk'],['Daily Express','Sunday Express','Daily and Sunday Express','Express, The/The Express on Sunday']],
 ['i-paper','i','#d71920',['inews.co.uk'],['i paper','The i Paper','i']],
 ['city-am','CA','#17394b',['cityam.com'],['City A.M.']],
 ['financial-times','FT','#71452e',['ft.com'],['Financial Times','The Financial Times']],
 ['morning-star','MS','#b51d2b',['morningstaronline.co.uk'],['Morning Star','The Morning Star']],
 ['herald','H','#171717',['heraldscotland.com'],['The Herald','Herald, The']],
 ['national','N','#173f48',['thenational.scot'],['The National','National, The']],
 ['scotsman','SC','#173f48',['scotsman.com'],['The Scotsman','Scotsman, The','Scotland on Sunday','The Scotsman / Scotland on Sunday','Scotsman, The/Scotland on Sunday']],
 ['press-journal','PJ','#173f48',['pressandjournal.co.uk'],['The Press and Journal','Press & Journal, The']],
 ['news-letter','NL','#173f48',['newsletter.co.uk'],['News Letter']],
 ['sunday-post','SP','#b51d2b',['sundaypost.com'],['The Sunday Post','Sunday Post, The']],
 ['irish-times','IT','#173f48',['irishtimes.com'],['The Irish Times','Irish Times']],
 ['irish-independent','II','#174c42',['independent.ie'],['Irish Independent','Sunday Independent']],
 ['irish-examiner','IE','#155e9c',['irishexaminer.com'],['Irish Examiner']],
 ['belfast-telegraph','BT','#173f48',['belfasttelegraph.co.uk'],['Belfast Telegraph','Sunday Life']],
 ['wales-online','W','#c62828',['walesonline.co.uk'],['WalesOnline','Western Mail','Wales on Sunday']],
 ['north-wales','NW','#c62828',['dailypost.co.uk'],['North Wales Live','Daily Post']],
 ['manchester','ME','#c62828',['manchestereveningnews.co.uk'],['Manchester Evening News']],
 ['liverpool','LE','#c62828',['liverpoolecho.co.uk'],['Liverpool Echo']],
 ['birmingham','BL','#c62828',['birminghammail.co.uk'],['Birmingham Live','Birmingham Mail']],
 ['new-york-times','NY','#121212',['nytimes.com'],['The New York Times','New York Times']],
 ['new-york-post','NP','#c00000',['nypost.com'],['New York Post']],
 ['npr','NPR','#17332f',['npr.org'],['NPR']],
 ['washington-post','WP','#222222',['washingtonpost.com'],['The Washington Post','Washington Post']],
 ['wall-street-journal','WS','#222222',['wsj.com'],['The Wall Street Journal','Wall Street Journal']],
 ['dawn','D','#111111',['dawn.com'],['Dawn']],
 ['indian-express','IE','#c00000',['indianexpress.com'],['The Indian Express']],
 ['hindustan-times','HT','#008b9b',['hindustantimes.com'],['Hindustan Times']],
 ['straits-times','ST','#0c294a',['straitstimes.com'],['The Straits Times']],
 ['daily-maverick','DM','#9b4b00',['dailymaverick.co.za'],['Daily Maverick']]
].map(([id,letters,color,hosts,names])=>Object.freeze({id,letters,color,hosts:Object.freeze(hosts),names:Object.freeze(names)}));

const byHost=new Map(ARTICLE_ICON_PROFILES.flatMap(p=>p.hosts.map(host=>[host,p])));
const normalize=value=>String(value||'').replace(/\s+/g,' ').trim().toLowerCase();
const byName=new Map(ARTICLE_ICON_PROFILES.flatMap(p=>p.names.map(name=>[normalize(name),p])));
export const ARTICLE_ICON_PATHS=new Set(ARTICLE_ICON_PROFILES.map(p=>'/publisher-icons/'+p.id+'.svg'));
const hostname=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.hostname.replace(/^(?:www|m|amp)\./,''):'';}catch{return '';}};
export function articleIconProfile(page){
 const capture=page?.document?.capture,raw=page?.sourceURL||capture?.url,host=hostname(raw);
 if(raw&&!host)return null;
 if(byHost.has(host))return byHost.get(host);
 // A library record has a provider URL, so use its established publication
 // label. Never infer a publisher from a headline or arbitrary URL words.
 if(host&&!['infoweb.newsbank.com','infoweb.newsbank.co.uk'].includes(host))return null;
 const label=normalize(capture?.publisher),base=label.split(/[:(]/,1)[0].trim();
 return byName.get(label)||byName.get(base)||null;
}
export function articleIconHref(page){const p=articleIconProfile(page);return p?'/publisher-icons/'+p.id+'.svg?v=1':'/favicon.svg';}
export function withArticleIcon(html,page){
 const {document}=parseHTML(html);
 for(const link of document.head.querySelectorAll('link[rel]'))if(link.getAttribute('rel').toLowerCase().split(/\s+/).includes('icon'))link.remove();
 const icon=document.createElement('link');
 icon.setAttribute('rel','icon');icon.setAttribute('type','image/svg+xml');icon.setAttribute('sizes','any');icon.setAttribute('href',articleIconHref(page));
 document.head.append(icon);
 return '<!doctype html>'+document.documentElement.outerHTML;
}
