/**
 * Walking Dead mode for Wordle: answers from the main TV show only (all 11 seasons). No comics-only
 * characters, no spin-offs (Fear, World Beyond, Dead City, Daryl Dixon, The Ones Who Live), and no
 * behind-the-scenes names: just people, places and things a viewer of the show would know.
 * Grouped by kind so the game can say what the word was ("DARYL: a character") once a round is over.
 * Only 3 to 8 letters: there are too few two-letter ones to make a game of.
 */

export type WalkingDeadKind = 'character' | 'place' | 'weapon' | 'dead' | 'survival' | 'episode'

export const WALKING_DEAD_KINDS: Record<WalkingDeadKind, string> = {
  character: 'a character',
  place: 'a place or group',
  weapon: 'a weapon or gear',
  dead: 'about the dead',
  survival: 'surviving the apocalypse',
  episode: 'an episode title'
}

// A word listed under two kinds counts as the first one.
const WORDS: Record<WalkingDeadKind, string> = {
  // Season by season, roughly in the order they turn up.
  character: `
    rick carl lori shane glenn morgan duane jenny merle andrea amy dale jim jacqui morales jenner ed
    daryl carol sophia hershel maggie beth otis patricia jimmy tdog
    michonne axel oscar tomas governor philip blake penny milton martinez tyreese sasha karen
    lizzie mika judith patrick zach bob eugene rosita abraham tara joe len
    gareth mary noah dawn gorman
    aaron eric deanna reg aiden spencer jessie ron sam pete olivia enid denise nicholas owen heath
    tobin jesus paul gregory negan lucille simon dwight sherry amber ezekiel shiva richard benjamin
    jerry jadis anne cyndie natania arat laura
    siddiq alden carson tanya frankie gavin jared regina
    alpha beta lydia henry magna yumiko luke connie kelly gamma earl tammy gage ozzy alek kal dante
    pamela lance hornsby mercer max maxine princess juanita elijah leah annie
    grimes greene rhee peletier dixon
  `,
  place: `
    atlanta georgia virginia prison farm barn quarry camp terminus woodbury hilltop kingdom grady
    hospital church cdc highway bridge tower walls gate fence saviors claimers wolves hunters
  `,
  weapon: `
    katana crossbow bolt bolts arrow arrows axe machete python colt revolver rifle shotgun pistol
    sniper silencer knife blade shiv spear sword hammer shovel crowbar pipe wrench bat bow barbed
    wire helmet armor grenade dynamite molotov rpg tank bayonet hacksaw handcuff gun guns ammo bullet
    bullets scope sling pickaxe hatchet cleaver dagger mace chain chains rope trap traps snare
    tripwire spike poncho vest badge hat radio walkie flare backpack canteen compass
  `,
  dead: `
    walker walkers biter biters roamer roamers lurker lurkers zombie zombies undead dead corpse
    herd horde hordes rotten decay decayed guts blood bloody brain brains skull bite bitten fever
    turn turned turning infected infested infect virus cure outbreak plague rot stench smell groan
    moan growl headshot headless dying death die grave graves bones flesh hungry hunger swarm
    winslow teeth jaw pit pikes heads border skeleton carcass maggot putrid shuffle
  `,
  survival: `
    survive survivor survival scavenge supply supplies run food water shelter fire campfire tent
    group family leader council savior whisper mask masks skin hide trade rations kneel tribute
    wolf cannibal compound exile exiled safe zone safezone wall rule rules trust mercy fight
    fighter save saved loss grief alive live hope noise silent quiet whistle bell bait signal map
    road truck bike chopper fuel gas gasoline pharmacy medicine doctor medic amputate stump eyepatch
    patch scar arm leg eye rooftop squirrel deer cherokee seeds garden crops forge armory solar
    fair pudding tiger horse dog wings angel priest pray tracker track archer hunt soldier trooper
    troopers military bunker stranger overrun war eat cut
  `,
  episode: `
    guts vatos wildfire secrets nebraska seed sick hounded home prey after inmates claimed still
    alone grove slabtown consumed crossed coda them remember forget spend try conquer now east
    service swear mercy damned monsters honor worth wrath bridge obliged omega bounty scars storm
    ghosts bonds squeeze stalker tower splinter diverged acheron hunted lockdown warlords faith
    variant family key
  `
}

/** Every answer by length, and what kind of word each one is (the first kind it's listed under). */
export const WALKING_DEAD_ANSWERS: Record<number, string[]> = {}
export const WALKING_DEAD_KIND_OF: Record<string, WalkingDeadKind> = {}

for (const kind of Object.keys(WORDS) as WalkingDeadKind[]) {
  for (const word of WORDS[kind].split(/\s+/)) {
    if (!/^[a-z]{3,8}$/.test(word) || WALKING_DEAD_KIND_OF[word]) continue
    WALKING_DEAD_KIND_OF[word] = kind
    ;(WALKING_DEAD_ANSWERS[word.length] ??= []).push(word)
  }
}
