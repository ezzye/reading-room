import {libraryPublicationForURL,libraryPublication} from './library-publications.mjs';
export {OBSERVER_PUBLICATION_LABEL,matchesLibraryPublication} from './library-publications.mjs';
export function libraryArticle(raw){const paper=libraryPublicationForURL(raw);if(libraryPublication(paper.key).urlIntakeEnabled===false)throw Error('This newspaper currently supports selected library records only.');return paper;}
