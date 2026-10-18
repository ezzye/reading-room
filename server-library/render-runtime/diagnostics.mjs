const STAGES=new Set(['render-start','runtime-guard','dependency-load','dependency-ready','pack-cache-check','pack-download','pack-verified','pack-extract','pack-ready','binary-extract','binary-ready','browser-launch','browser-ready','context-create','context-ready','network-setup','navigation','navigation-complete','snapshot','snapshot-ready','render-stop','render-error','render-close']);
const CODES=new Set(['render_timeout','render_runtime_unavailable','render_version','pack_download','pack_integrity','pack_entry','ENOENT','EACCES','ENOSPC','ERR_MODULE_NOT_FOUND','ERR_PACKAGE_PATH_NOT_EXPORTED','ERR_REQUIRE_ESM','ENOTFOUND','ECONNRESET','ECONNREFUSED','ETIMEDOUT','public_metadata','no_public_media','invalid_request','invalid_url','redirect_mismatch','redirect_limit','http_denied','challenge','unsupported_content','response_too_large','empty_response','identity_mismatch','headline_missing','timed_out','request_failed']);
const NAMES=new Set(['Error','TypeError','SyntaxError','ReferenceError','RangeError','TimeoutError','AbortError','ProtocolError','TargetCloseError','UnsupportedOperation']);

export function safeRenderDiagnostic(stage,error){
 const record={stage:STAGES.has(stage)?stage:'render-error'};
 if(error!==undefined){
  const code=[error?.code,error?.message,error?.cause?.code].find(value=>CODES.has(value));
  record.errorCode=code||'unclassified';record.errorName=NAMES.has(error?.name)?error.name:'Error';
 }
 return record;
}
export function logRenderStage(stage,error,write=console.info){
 // Never log error messages, stacks, URLs, browser output, environment values,
 // account fields or document data. Both field names and values are bounded.
 try{write('ReadingRoom public renderer '+JSON.stringify(safeRenderDiagnostic(stage,error)));}catch{}
}
