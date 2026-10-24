export const REFERENCE_KIND='camden-reference-v1';
/** @type {[string,string,string,string,string,string[],string][]} */
const rows=[
 ['american-national-biography','American National Biography','Biography','Biographies of significant people in American history.','https://www.anb.org/',['www.anb.org','anb.org'],'www.anb.org'],
 ['benezit','Benezit Dictionary of Artists','Art','Biographies of artists.','https://www.oxfordartonline.com/benezit',['www.oxfordartonline.com','oxfordartonline.com'],'www.oxfordartonline.com'],
 ['britannica','Britannica Library','Reference','Age-appropriate reference for learning, projects and general reading.','https://library.eb.co.uk/storelibrarycard?id=camden&target=%2Flevels%2Fadult',['library.eb.co.uk','education.eb.co.uk'],'library.eb.co.uk'],
 ['cobra','COBRA','Business','Business start-up, self-employment, sector and career research.','https://camden.cobwebinfo.com/',['camden.cobwebinfo.com'],'camden.cobwebinfo.com'],
 ['oed','Oxford English Dictionary','Dictionary','Word meanings, history, spelling and pronunciation.','https://www.oed.com/',['www.oed.com','oed.com'],'www.oed.com'],
 ['oxford-dictionaries','Oxford Dictionaries','Dictionary','Bilingual dictionaries and word translations.','https://premium.oxforddictionaries.com/',['premium.oxforddictionaries.com'],'premium.oxforddictionaries.com'],
 ['whos-who','Who’s Who','Biography','Biographical directory of influential people in public life.','https://www.ukwhoswho.com/',['www.ukwhoswho.com','ukwhoswho.com'],'www.ukwhoswho.com'],
 ['grove-art','Grove Art Online','Art','Art and artists, including painting, sculpture, architecture and design.','https://www.oxfordartonline.com/',['www.oxfordartonline.com','oxfordartonline.com'],'www.oxfordartonline.com'],
 ['odnb','Oxford Dictionary of National Biography','Biography','Biographies of people who shaped British history.','https://www.oxforddnb.com/',['www.oxforddnb.com','oxforddnb.com'],'www.oxforddnb.com'],
 ['oxford-music','Oxford Music Online','Music','Music reference covering composers, performers and musical topics.','https://www.oxfordmusiconline.com/subscriber/book/omo_gmo',['www.oxfordmusiconline.com','oxfordmusiconline.com'],'www.oxfordmusiconline.com'],
 ['oxford-worlds-classics','Oxford World’s Classics','Books','Read novels and other writings from the Medieval period to the 20th century.','https://oxfordworldsclassics.com/',['oxfordworldsclassics.com','www.oxfordworldsclassics.com'],'oxfordworldsclassics.com'],
 ['newsbank','Newsbank','Newspapers','Search current and archived UK newspapers and articles.','https://infoweb.newsbank.com/',['infoweb.newsbank.com'],'infoweb.newsbank.com'],
 ['times-collection','The London Times Collection','Newspapers','Search The Times and The Sunday Times from 1985 onward.','https://infoweb.newsbank.com/',['infoweb.newsbank.com'],'infoweb.newsbank.com'],
 ['times-digital-archive','The Times Digital Archive','Newspapers','Search the archive from 1785 to 2014.','https://go.gale.com/ps/artemis?p=TTDA&u=camlib',['gdc.galegroup.com','go.gale.com'],'go.gale.com'],
 ['libby','Libby','Books and audio','Borrow e-books and audiobooks; app available.','https://camdenlibrary.overdrive.com/',['camdenlibrary.overdrive.com'],'camdenlibrary.overdrive.com'],
 ['borrowbox','BorrowBox','Books and audio','Borrow e-books, audiobooks and ePress; app available.','https://camdenuk.borrowbox.com/',['camdenuk.borrowbox.com'],'camdenuk.borrowbox.com'],
 ['pressreader','PressReader','Newspapers and magazines','Read UK and international newspapers and magazines.','https://www.pressreader.com/',['www.pressreader.com','pressreader.com'],'www.pressreader.com'],
 ['comics-plus','Comics Plus','Comics','Choose the age-appropriate collection from Camden’s digital library.','https://www.camden.gov.uk/digital-library',['login.librarypass.com'],'login.librarypass.com'],
 ['kanopy','Kanopy','Film','Stream films and documentaries with a Camden library card.','https://www.kanopy.com/',['www.kanopy.com','kanopy.com'],'www.kanopy.com'],
 ['theory-test-pro','Theory Test Pro','Learning','Practice for the UK driving theory test.','https://camden.theorytestpro.co.uk/',['camden.theorytestpro.co.uk'],'camden.theorytestpro.co.uk'],
 ['gocitizen','GoCitizen','Learning','Study materials and practice questions for the Life in the UK test.','https://camden.gocitizen.co.uk/',['camden.gocitizen.co.uk'],'camden.gocitizen.co.uk'],
 ['alison','Alison','Learning','Explore free online courses.','https://alison.com/',['alison.com','www.alison.com'],'alison.com'],
];
export const CAMDEN_RESOURCES=Object.freeze(rows.map(([id,name,category,description,entryURL,hosts,searchHost])=>Object.freeze({id,name,category,description,entryURL,hosts:Object.freeze(hosts),searchHost})));
const byId=new Map(CAMDEN_RESOURCES.map(resource=>[resource.id,resource]));
export function camdenResource(id){return byId.get(id)||null;}
const tracking=/^(?:utm_.+|fbclid|gclid|mc_[ce]id)$/i;
const citationParams=new Set(['q','query','search','term','id','title','article','page','p','volume','issue','year','doi','isbn','issn','author','authors','subject','topic','edition','chapter','entry','querytext','start','offset','resultsperpage','sort','filter','publication','pub','record','documentid','citation','loc','context']);
const sensitiveValue=value=>/^[a-f0-9]{24,}$/i.test(value)||/^\d{16,}$/.test(value)||/^[a-z0-9_-]{40,}$/i.test(value);
export function referenceURL(raw,id){
 const resource=camdenResource(id);if(!resource||typeof raw!=='string'||raw.length>4096)throw new TypeError('Invalid reference URL');
 let url;try{url=new URL(raw);}catch{throw new TypeError('Invalid reference URL');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hostname.toLowerCase()!==url.hostname||!resource.hosts.includes(url.hostname.toLowerCase()))throw new TypeError('Unapproved reference URL');
 for(const key of [...url.searchParams.keys()])if(tracking.test(key))url.searchParams.delete(key);
 if(/(?:^|\/)(?:login|log-in|sign-in|signin|logout|account|my-account|subscribe|checkout|auth|oauth|password|forgot-password|reset(?:-password)?|verify(?:-email)?|verification|share(?:[-_]token)?|invite|invitation|[^/]*library-?card[^/]*|[^/]*borrower-?card[^/]*)(?:\/|$)/i.test(url.pathname))throw new TypeError('Authentication or sharing URLs are not references');
 for(const [key,value] of url.searchParams){if(!citationParams.has(key.toLowerCase())||value.length>512||/[\u0000-\u001f\u007f-\u009f]/.test(value)||/^(?:https?:)?\/\//i.test(value)||sensitiveValue(value))throw new TypeError('Private or non-citation query parameter');}
 url.hash='';return url.href;
}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderReference(page){
 const document=page?.document,resource=camdenResource(document?.resourceId);if(document?.kind!==REFERENCE_KIND||!resource)throw new TypeError('Unknown Camden reference');
 const href=referenceURL(page.sourceURL||document.url,resource.id),title=esc(page.title||document.title||resource.name),provider=esc(resource.name),entry=esc(resource.entryURL);
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+' · Reading Room</title><style>*,*:before,*:after{box-sizing:border-box}body{margin:0;padding:1rem;background:#f6f4ef;color:#20231f;font:16px/1.5 system-ui,sans-serif}.card{max-width:42rem;margin:0 auto;background:white;border:1px solid #ddd8ce;border-radius:1rem;padding:clamp(1rem,5vw,2rem);box-shadow:0 8px 30px #20231f0d}h1{font-size:clamp(1.45rem,6vw,2rem);line-height:1.2;margin:.35rem 0 .5rem}.provider{color:#59635a;font-size:.9rem}.primary{display:block;text-align:center;margin:1.25rem 0 .75rem;padding:.9rem 1rem;border-radius:.7rem;background:#234d3b;color:white;text-decoration:none;font-weight:650}.signin{font-size:.88rem;color:#536054}a:focus-visible{outline:3px solid #bd7a32;outline-offset:3px}</style></head><body><main class="card"><p class="provider">'+provider+'</p><h1>'+title+'</h1><a class="primary" href="'+esc(href)+'" target="_blank" rel="noreferrer">Open reading at '+provider+' ↗</a><p class="signin">Camden library access may be required. <a href="'+entry+'" target="_blank" rel="noreferrer">Open the library sign-in page</a>.</p></main></body></html>';
}
