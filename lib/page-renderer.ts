import {withArticleIcon} from './article-icons.mjs';
import {LIBRARY_KIND,renderLibraryStudy,libraryHeaders} from './library-study.mjs';
import template from './critical-times.html?raw';
import {renderPage,pageHeaders} from './education-core.mjs';
import {isCriticalPage,renderCritical,criticalHeaders} from './critical-core.mjs';
import {CAPTURE_KIND,renderCapture,captureHeaders} from './capture-core.mjs';
import {sanitizePublicCapturePresentation} from './readable-presentation.mjs';
import {withDiscussion} from './discussion-view.mjs';
export function pageResponse(page:any,owner=false,token=''){
 if(page?.document?.capture)page={...page,document:{...page.document,capture:sanitizePublicCapturePresentation(page.document.capture)}};
 const critical=isCriticalPage(page),captured=page?.document?.kind===CAPTURE_KIND;
 const library=page?.document?.kind===LIBRARY_KIND;
 const html=library?renderLibraryStudy(page):critical?renderCritical(template,page,{owner}):captured?renderCapture(page,{owner}):renderPage(page,{owner});
 return new Response(withArticleIcon(withDiscussion(html,page,{owner,token}),page),{headers:library?libraryHeaders:critical?criticalHeaders:captured?captureHeaders:pageHeaders});
}
