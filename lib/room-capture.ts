import {requireRoom,accessiblePage} from './rooms.ts';
import {roomBody} from './room-articles.ts';
import {captureAPI} from './capture-service.ts';
import type {Config} from './education-service.ts';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
export async function roomCaptureAPI(request:Request,config:Config,fetcher:typeof fetch=fetch){
 try{
  const room=await requireRoom(request,config);
  if(request.method!=='POST')return Response.json({error:'Method not allowed.'},{status:405,headers});
  let input:any;try{input=await roomBody(request.clone() as unknown as Request,1048576);}catch(error){if(error instanceof Response)return error;return Response.json({error:'Use a reviewed capture JSON file.'},{status:400,headers});}
  const prose=Array.isArray(input.capture?.blocks)?input.capture.blocks.filter((block:any)=>['paragraph','quote'].includes(block?.type)).map((block:any)=>typeof block.text==='string'?block.text:'').join(' '):'';
  if(input.capture?.diagnostics?.accessBlocked||/subscribe to (?:continue|read)|sign in to continue|unlock (?:this|the) article/i.test(prose))return Response.json({error:'This capture appears to contain an access gate. Open a readable full article first.'},{status:400,headers});
  const response=await captureAPI(request,config,fetcher);
  if(!response.ok)return response;
  const data=await response.json() as {id?:string,cached?:boolean};
  if(!data.id||!await accessiblePage(request,config,data.id))return Response.json({error:'Capture was not added to this room.'},{status:502,headers});
  return Response.json({...data,href:'/read/'+data.id+'?room='+room.id},{headers});
 }catch(error){if(error instanceof Response)return error;return Response.json({error:'Capture could not be imported.'},{status:502,headers});}
}
