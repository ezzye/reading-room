import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanPublisherHeadline} from './publisher-headline.mjs';

test('removes the exact known Telegraph index branding suffix',()=>{
  assert.equal(cleanPublisherHeadline('Students tear-gassed in France - UK News Website of the Year 2024'),'Students tear-gassed in France');
});

test('preserves legitimate headline wording that mentions the award phrase',()=>{
  const title='UK News Website of the Year 2024 awards recognise local reporting';
  assert.equal(cleanPublisherHeadline(title),title);
  assert.equal(cleanPublisherHeadline('A report about the UK News Website of the Year 2024'),'A report about the UK News Website of the Year 2024');
});
