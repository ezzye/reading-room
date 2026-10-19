const message='The library service is busy. Please try again shortly.';
export class LibraryServiceBusyError extends Error{
 constructor(){super(message);this.name='LibraryServiceBusyError';this.code='library_service_busy';}
}
export const isLibraryServiceBusyError=error=>error instanceof LibraryServiceBusyError;
export function libraryServiceBusyResponse(){return Response.json({error:message,errorCode:'library_service_busy',retryAfterSeconds:10},{status:503,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Retry-After':'10'}});}
