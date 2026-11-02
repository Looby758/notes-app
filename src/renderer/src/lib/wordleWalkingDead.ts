/**
 * Walking Dead mode for Wordle: answers from The Walking Dead and its spin-offs (Fear the Walking
 * Dead, World Beyond, Dead City, Daryl Dixon, The Ones Who Live, Telltale's game). Grouped by kind
 * so the game can say what the word was ("DARYL: a character") once a round is over.
 * Only 3 to 8 letters: there are too few two-letter ones to make a game of.
 */

export type WalkingDeadKind = 'character' | 'place' | 'weapon' | 'dead' | 'survival' | 'episode' | 'show'

export const WALKING_DEAD_KINDS: Record<WalkingDeadKind, string> = {
  character: 'a character',
  place: 'a place or group',
  weapon: 'a weapon or gear',
  dead: 'about the dead',
  survival: 'surviving the apocalypse',
  episode: 'an episode title',
  show: 'about the show'
}

// A word listed under two kinds counts as the first one.
const WORDS: Record<WalkingDeadKind, string> = {
  character: `
    rick carl lori shane glenn maggie daryl merle carol sophia andrea amy dale jim jacqui morales
    jenner ed hershel beth otis patricia jimmy tdog theodore douglas axel oscar tomas lizzie mika
    judith michonne andre philip blake penny milton martinez caesar shumpert allen donna ben
    governor tyreese sasha bob karen zach patrick eugene rosita abraham abe tara gareth mary dawn
    noah aaron eric deanna reg monroe aiden nicholas pete jessie ron sam spencer olivia enid denise
    heath tobin francine holly jesus paul rovia gregory negan lucille annie simon dwight sherry
    regina gavin jared arat laura frankie tanya amber ezekiel shiva richard benjamin jerry diane kal
    jadis anne cyndie natania siddiq alden alpha beta gamma lydia henry magna yumiko luke connie
    kelly dante margo ozzy alek pamela lance hornsby mercer max maxine princess juanita elijah leah
    gage earl tammy rose morgan duane jenny grimes greene rhee peletier dixon carson gorman owen
    joe len
    madison travis liza nick alicia chris ofelia daniel griselda strand victor celia salazar clark
    manawa otto troy jake naomi john dorie althea june wendell charlie sarah luciana virginia dakota
    teddy grace logan wes
    iris hope elton silas felix huck jennifer percy leo kublek
    perlie croat ginny tommaso isabelle laurent sylvie quinn genet codron losang
    thorne okafor beale nat
    lee kenny duck omid christa molly sarita violet louis marlon tenn javier
  `,
  place: `
    atlanta georgia virginia prison farm barn quarry camp terminus woodbury hilltop kingdom grady
    hospital church cdc senoia highway bridge tower walls gate fence colony paris france spain
    campus omaha nebraska ericson saviors whispers claimers wolves hunters militia crm
    republic civic
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
    moan growl headshot headless dying death die grave graves bones flesh hungry hunger
    swarm winslow teeth jaw pit pikes heads border skeleton carcass maggot putrid shuffle
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
    ghosts bonds squeeze stalker tower splinter diverged acheron hunted lockdown faith variant
    family key
  `,
  show: `amc kirkman adlard gimple darabont image comic comics fear spinoff finale telltale deadcity`
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
