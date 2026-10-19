import test from 'node:test';
import assert from 'node:assert/strict';
import {observerURLHeadlineMatches} from './observer-url-headline.mjs';
const requested='childrens commissioner compares fictional bridge safety in 2026';
test('complete ordered URL headline equality permits only case, punctuation, apostrophe loss, whitespace and NFC representation',()=>{
 for(const title of ['Children’s commissioner compares fictional bridge safety in 2026',"Children's commissioner compares fictional bridge safety in 2026",'CHILDREN’S COMMISSIONER COMPARES “FICTIONAL BRIDGE SAFETY” IN 2026','Children’s commissioner\ncompares fictional bridge safety in 2026 - An explicit synthetic library standfirst.'])assert(observerURLHeadlineMatches(requested,title));
 assert(observerURLHeadlineMatches('cafés community compares fictional bridge safety','Cafe\u0301s community compares fictional bridge safety'));
});
test('complete identity rejects changed suffixes, numbers, order, dropped/repeated words and semantic stemming',()=>{
 for(const title of ['Children’s commissioner compares fictional bridge safety in 2026 again','Children’s commissioner compares fictional bridge safety in 2027','Children’s commissioner compares fictional safety bridge in 2026','Children’s commissioner compares fictional bridge in 2026','Children’s commissioner compares fictional bridge bridge safety in 2026','Children’s commissioner compares fictional bridges safety in 2026','Children’s commissioner compares fictional bridge safety in 2026 | The Observer','<span>Children’s commissioner compares fictional bridge safety in 2026</span>'])assert.equal(observerURLHeadlineMatches(requested,title),false,title);
 assert.equal(observerURLHeadlineMatches('childrens commissioner reports burning fictional bridges','Children’s commissioner reports fire fictional bridges'),false);
 for(const title of ['',null,{},'x'.repeat(601)])assert.equal(observerURLHeadlineMatches(requested,title),false);
 assert.equal(observerURLHeadlineMatches('',requested),false);
});
