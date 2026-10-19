import type {ActiveRoom} from './rooms.ts';
import type {Config} from './education-service.ts';

export const SHELF_PAGE_SIZE=50;
type ShelfView='active'|'archived';
type ShelfCursor={v:1;roomId:string;view:ShelfView;date:string;id:string};
const fail=(status:number,error:string)=>Response.json({error},{status,headers:{'Cache-Control':'private, no-store'}});
function encodeCursor(cursor:ShelfCursor){return btoa(JSON.stringify(cursor)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function decodeCursor(raw:string,roomId:string,view:ShelfView):ShelfCursor {
 try{
  if(!/^[A-Za-z0-9_-]{1,600}$/.test(raw))throw Error();
  const c=JSON.parse(atob(raw.replace(/-/g,'+').replace(/_/g,'/')));
  if(c?.v!==1||c.roomId!==roomId||c.view!==view||typeof c.date!=='string'||c.date.length>40||!Number.isFinite(Date.parse(c.date))||typeof c.id!=='string'||!/^[a-f0-9]{48}$/.test(c.id))throw Error();
  return c;
 }catch{throw fail(400,'This article list has changed. Refresh the shelf and try again.');}
}

export async function readRoomShelf(request:Request,c:Config,room:ActiveRoom,metadata:(row:any)=>any){
 const url=new URL(request.url),view=url.searchParams.get('view')||'active';
 if(view!=='active'&&view!=='archived')throw fail(400,'Choose Shelf or Archived.');
 const size=url.searchParams.get('limit');
 if(size!==null&&!/^(?:[1-9]|[1-9][0-9]|100)$/.test(size))throw fail(400,'Choose an article page size from 1 to 100.');
 const limit=size===null?SHELF_PAGE_SIZE:Number(size),rawCursor=url.searchParams.get('cursor');
 const cursor=rawCursor===null?null:decodeCursor(rawCursor,room.id,view);
 const date=view==='archived'?'ar.archived_at':'a.created_at';
 const params:any[]=[room.member_id,room.role,room.id];
 if(cursor)params.push(cursor.date,cursor.date,cursor.id);
 params.push(limit+1);
 const result=await c.DB.prepare(`SELECT p.id,p.title,p.source_url,p.document,a.created_at AS addedAt,ar.archived_at AS archivedAt,
  (SELECT COUNT(*) FROM rr_room_comments m WHERE m.room_id=a.room_id AND m.page_id=p.id AND (m.status='approved' OR m.member_id=? OR ?='owner')) AS commentCount
  FROM rr_room_articles a JOIN education_pages p ON p.id=a.page_id
  LEFT JOIN rr_room_article_archive ar ON ar.room_id=a.room_id AND ar.page_id=a.page_id
  WHERE a.room_id=? AND ar.page_id IS ${view==='active'?'NULL':'NOT NULL'}
  ${cursor?`AND (${date}<? OR (${date}=? AND p.id<?))`:''}
  ORDER BY ${date} DESC,p.id DESC LIMIT ?`).bind(...params).all<any>();
 const all=result.results||[],rows=all.slice(0,limit),last=rows.at(-1),hasMore=all.length>limit;
 const counts=await c.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN ar.page_id IS NULL THEN 1 ELSE 0 END),0) AS active,
  COALESCE(SUM(CASE WHEN ar.page_id IS NOT NULL THEN 1 ELSE 0 END),0) AS archived
  FROM rr_room_articles a JOIN education_pages p ON p.id=a.page_id
  LEFT JOIN rr_room_article_archive ar ON ar.room_id=a.room_id AND ar.page_id=a.page_id WHERE a.room_id=?`).bind(room.id).first<any>();
 return {articles:rows.map(row=>({...metadata(row),archivedAt:row.archivedAt||null})),room:{id:room.id,name:room.name,role:room.role},view,
  counts:{active:Number(counts?.active||0),archived:Number(counts?.archived||0)},canArchive:room.role==='owner',
  page:{nextCursor:hasMore&&last?encodeCursor({v:1,roomId:room.id,view,date:view==='archived'?last.archivedAt:last.addedAt,id:last.id}):null,hasMore,limit}};
}

export async function updateRoomArticleArchive(c:Config,room:ActiveRoom,action:'archive'|'restore',id:unknown,now=Date.now()){
 if(room.role!=='owner')throw fail(403,'Only the room owner can archive or restore articles.');
 if(typeof id!=='string'||!/^[a-f0-9]{48}$/.test(id))throw fail(400,'Choose an article from this room.');
 // Recheck active ownership inside each write; never trust a client role or target room.
 const authority=`SELECT a.room_id,a.page_id FROM rr_room_articles a
  JOIN rr_room_members rm ON rm.room_id=a.room_id JOIN rr_members m ON m.id=rm.member_id
  WHERE a.room_id=? AND a.page_id=? AND rm.member_id=? AND rm.role='owner' AND rm.revoked_at IS NULL AND m.revoked_at IS NULL`;
 if(action==='archive'){
  await c.DB.prepare(`INSERT INTO rr_room_article_archive(room_id,page_id,archived_by,archived_at)
   SELECT target.room_id,target.page_id,?,? FROM (${authority}) target WHERE 1
   ON CONFLICT(room_id,page_id) DO NOTHING`).bind(room.member_id,new Date(now).toISOString(),room.id,id,room.member_id).run();
 }else{
  await c.DB.prepare(`DELETE FROM rr_room_article_archive WHERE room_id=? AND page_id=? AND EXISTS (${authority})`)
   .bind(room.id,id,room.id,id,room.member_id).run();
 }
 const found=await c.DB.prepare(`SELECT ar.archived_at AS archivedAt FROM (${authority}) target
  LEFT JOIN rr_room_article_archive ar ON ar.room_id=target.room_id AND ar.page_id=target.page_id`).bind(room.id,id,room.member_id).first<any>();
 if(!found)throw fail(404,'Article not found in this room.');
 return {id,archived:Boolean(found.archivedAt),archivedAt:found.archivedAt||null};
}
