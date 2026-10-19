import test from 'node:test';
import assert from 'node:assert/strict';
import {LibraryServiceBusyError,isLibraryServiceBusyError,libraryServiceBusyResponse} from './library-service-busy.mjs';
test('service busy is a fixed local exception and safe503 response, never a caller-shaped assertion',async()=>{
 const error=new LibraryServiceBusyError('PRIVATE BODY');assert(isLibraryServiceBusyError(error));assert.equal(error.code,'library_service_busy');assert.doesNotMatch(error.message,/PRIVATE/);
 for(const fake of [{code:'library_service_busy'},JSON.parse(JSON.stringify(error)),new Error(error.message),null])assert.equal(isLibraryServiceBusyError(fake),false);
 const response=libraryServiceBusyResponse();assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'10');assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(await response.json(),{error:'The library service is busy. Please try again shortly.',errorCode:'library_service_busy',retryAfterSeconds:10});
});
