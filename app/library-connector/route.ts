import setup from '../../lib/library-connector-setup.html?raw';
import {pageHeaders} from '../../lib/education-core.mjs';
export const dynamic='force-dynamic';
export const GET=()=>new Response(setup,{headers:pageHeaders});
