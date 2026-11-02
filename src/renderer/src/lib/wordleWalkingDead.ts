/**
 * Walking Dead mode for Wordle: answers from the main TV show only (all 11 seasons). No comics-only
 * characters, no spin-offs (Fear, World Beyond, Dead City, Daryl Dixon, The Ones Who Live), and no
 * behind-the-scenes names: just people, places and things a viewer of the show would know.
 * Grouped by kind so the game can say what the word was ("DARYL: a character") once a round is over.
 * Characters only, never the actors who play them. 2 to 8 letters, like Classic; the short lengths
 * have only a few words, so they come round again often.
 */

export type WalkingDeadKind = 'character' | 'place' | 'thing' | 'walker'

export const WALKING_DEAD_KINDS: Record<WalkingDeadKind, string> = {
  character: 'a character',
  place: 'a place or group',
  thing: 'something from the show',
  walker: 'what the show calls the dead'
}

// Only words that point to The Walking Dead itself. Everyday apocalypse words (guts, hide, bite,
// shelter) and episode titles that are ordinary words don't count, even when the show uses them.
// A word listed under two kinds counts as the first one.
const WORDS: Record<WalkingDeadKind, string> = {
  // Season by season, roughly in the order they turn up, then family names.
  character: `
    rick carl lori shane glenn morgan duane jenny merle andrea amy dale jim jacqui morales jenner ed
    daryl carol sophia hershel maggie beth otis patricia jimmy tdog
    michonne axel oscar tomas governor philip blake penny milton martinez tyreese sasha karen
    lizzie mika judith patrick zach bob eugene rosita abraham tara joe len
    gareth mary noah dawn gorman gabriel
    aaron eric deanna reg aiden spencer jessie ron sam pete olivia enid denise nicholas owen heath
    tobin jesus paul gregory negan lucille simon dwight sherry amber ezekiel shiva richard benjamin
    jerry jadis anne cyndie natania arat laura paula
    siddiq alden carson harlan tanya frankie gavin jared regina
    alpha beta lydia henry magna yumiko luke connie kelly gamma earl tammy gage ozzy alek kal dante
    pamela lance hornsby mercer max maxine princess juanita elijah leah annie rj
    grimes greene rhee peletier dixon monroe porter ford espinosa williams chambler
  `,
  place: `
    terminus woodbury hilltop kingdom saviors claimers atlanta cdc grady
  `,
  thing: `
    crossbow katana python winslow eyepatch pudding cherokee
  `,
  walker: `
    walker walkers biter biters roamer roamers lurker lurkers
  `
}

/** Every answer by length, and what kind of word each one is (the first kind it's listed under). */
export const WALKING_DEAD_ANSWERS: Record<number, string[]> = {}
export const WALKING_DEAD_KIND_OF: Record<string, WalkingDeadKind> = {}

for (const kind of Object.keys(WORDS) as WalkingDeadKind[]) {
  for (const word of WORDS[kind].split(/\s+/)) {
    if (!/^[a-z]{2,8}$/.test(word) || WALKING_DEAD_KIND_OF[word]) continue
    WALKING_DEAD_KIND_OF[word] = kind
    ;(WALKING_DEAD_ANSWERS[word.length] ??= []).push(word)
  }
}
