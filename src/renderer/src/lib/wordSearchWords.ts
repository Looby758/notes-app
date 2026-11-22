/**
 * Word lists for Word search. Each theme has far more words than one puzzle uses, so every puzzle is
 * a different mix. Words are 3 to 14 letters, lowercase, with no spaces (names of more than one word
 * are joined up, the way word searches usually print them).
 */

export type WordSearchTheme = 'walkingDead' | 'animals' | 'food' | 'space' | 'countries' | 'sports' | 'music' | 'everyday'

/** What kind of word a Walking Dead word is, shown when you find it. */
export type WalkingDeadSearchKind = 'character' | 'family' | 'place' | 'group' | 'thing' | 'walker'

export const WALKING_DEAD_SEARCH_KINDS: Record<WalkingDeadSearchKind, string> = {
  character: 'a character',
  family: 'a family name',
  place: 'a place',
  group: 'a group or community',
  thing: 'something from the show',
  walker: 'what the show calls the dead'
}

/**
 * The Walking Dead, from the main TV show only (all 11 seasons): no comics-only characters, no
 * spin-offs, no actors. Everyday zombie-apocalypse words (zombie, guts, dead, survival, bite, horde)
 * don't count, only words that point to the show itself. A word listed twice counts as its first kind.
 */
const WALKING_DEAD: Record<WalkingDeadSearchKind, string> = {
  character: `
    rick carl lori shane glenn morgan duane jenny merle andrea amy dale jim jacqui morales jenner
    daryl carol sophia hershel maggie beth otis patricia jimmy tdog
    michonne axel oscar tomas governor philip penny milton martinez tyreese sasha karen
    lizzie mika judith patrick zach bob eugene rosita abraham tara
    gareth noah dawn gorman lerner gabriel
    aaron eric deanna reg aiden spencer jessie ron sam pete olivia enid denise nicholas owen heath
    tobin jesus negan dwight sherry simon ezekiel shiva richard benjamin jerry jadis
    siddiq alden harlan jared regina laura arat
    alpha beta lydia henry magna yumiko luke connie kelly gamma earl tammy gage nabila
    pamela lance hornsby mercer maxine princess elijah leah sebastian
  `,
  family: `
    grimes greene rhee peletier dixon horvath stokes monroe porter ford espinosa chambler anderson
    milton carson
  `,
  place: `
    atlanta cdc woodbury terminus alexandria hilltop kingdom sanctuary oceanside commonwealth
    grady
  `,
  group: `
    saviors whisperers scavengers wolves claimers highwaymen
  `,
  thing: `
    lucille crossbow katana python eyepatch pocketwatch boxcar cherokee
  `,
  walker: `
    walker walkers biter biters roamer roamers lurker lurkers
  `
}

const ANIMALS = `
  aardvark albatross alligator alpaca anteater antelope armadillo baboon badger beaver bison buffalo
  butterfly camel caribou cheetah chimpanzee chinchilla cobra cougar coyote crocodile dolphin donkey
  dragonfly eagle elephant falcon ferret flamingo gazelle gecko gerbil giraffe gorilla hamster
  hedgehog heron hippo hyena iguana jaguar jellyfish kangaroo koala lemur leopard lobster lynx
  meerkat mongoose moose narwhal octopus orangutan ostrich otter panda panther parrot peacock
  pelican penguin pigeon platypus porcupine puffin rabbit raccoon reindeer rhino salmon scorpion
  seahorse shark sloth squirrel starfish stingray swan tiger tortoise toucan turtle vulture walrus
  weasel whale wolverine wombat zebra
`

const FOOD = `
  apple avocado bacon bagel banana biscuit blueberry broccoli brownie burrito butter cabbage
  carrot cheese cherry chocolate cinnamon coconut cookie croissant crumpet cucumber cupcake custard
  doughnut dumpling garlic ginger grape hotdog hummus jelly kebab ketchup lasagne lemon lettuce mango
  meatball melon muffin mushroom mustard noodle omelette onion orange pancake pasta peach peanut
  pepper pickle pineapple pizza popcorn potato pretzel pudding pumpkin raspberry risotto sandwich
  sausage spaghetti spinach strawberry sushi taco toast tomato trifle waffle walnut yogurt
`

const SPACE = `
  asteroid astronaut atmosphere aurora blackhole comet constellation cosmos crater eclipse equinox
  galaxy gravity jupiter launchpad lunar mars mercury meteor meteorite milkyway moon nebula neptune
  nova orbit planet pluto pulsar quasar rocket satellite saturn shuttle solstice spacesuit
  spacewalk starlight sunspot supernova telescope universe uranus venus zenith cosmonaut module
  capsule lander rover probe
`

const COUNTRIES = `
  argentina australia austria belgium brazil bulgaria cambodia canada chile china colombia croatia
  cuba cyprus denmark egypt england estonia ethiopia finland france germany ghana greece hungary
  iceland india indonesia iran ireland israel italy jamaica japan kenya latvia lithuania malaysia
  malta mexico monaco morocco nepal netherlands nigeria norway pakistan peru poland portugal qatar
  romania russia scotland senegal serbia singapore slovakia spain sweden switzerland thailand
  tunisia turkey uganda ukraine uruguay vietnam wales zambia zimbabwe
`

const SPORTS = `
  archery athletics badminton baseball basketball bowling boxing canoeing cricket croquet curling
  cycling darts diving fencing football golf gymnastics handball hockey hurdles javelin judo karate
  kayaking lacrosse marathon netball polo rounders rowing rugby sailing skating skiing snooker
  snowboarding softball squash surfing swimming taekwondo tennis triathlon volleyball wrestling
  goalkeeper referee stadium trophy medal penalty offside tackle
`

const MUSIC = `
  accordion album anthem ballad banjo bass beat cello chorus clarinet concert conductor cymbal drums
  duet encore flute guitar harmony harp keyboard lyrics melody microphone opera orchestra piano
  playlist pop rap rhythm saxophone singer soprano speaker stereo symphony tempo trombone trumpet
  tuba ukulele verse violin vinyl whistle xylophone headphones remix chord octave
`

const EVERYDAY = `
  backpack balloon bathroom bedroom blanket bottle bucket button calendar candle carpet castle
  ceiling chair cushion curtain diary doorbell drawer envelope fridge garden hammer helmet jacket
  kettle kitchen ladder lamp laptop letter library mailbox mirror notebook paper parcel pencil
  picture pillow postcard printer puzzle radio scissors shelf slipper sofa spoon stairs suitcase
  sweater table teapot ticket toaster toothbrush towel umbrella wallet window wardrobe
`

/** Every word in a list, lowercased and checked, with no repeats. */
function wordsOf(list: string): string[] {
  return [...new Set(list.split(/\s+/).filter((w) => /^[a-z]{3,14}$/.test(w)))]
}

export const WALKING_DEAD_KIND_OF: Record<string, WalkingDeadSearchKind> = {}
const walkingDeadWords: string[] = []
for (const kind of Object.keys(WALKING_DEAD) as WalkingDeadSearchKind[]) {
  for (const word of wordsOf(WALKING_DEAD[kind])) {
    if (WALKING_DEAD_KIND_OF[word]) continue
    WALKING_DEAD_KIND_OF[word] = kind
    walkingDeadWords.push(word)
  }
}

export const WORD_SEARCH_THEMES: { id: WordSearchTheme; label: string; words: string[] }[] = [
  { id: 'walkingDead', label: 'Walking Dead', words: walkingDeadWords },
  { id: 'animals', label: 'Animals', words: wordsOf(ANIMALS) },
  { id: 'food', label: 'Food', words: wordsOf(FOOD) },
  { id: 'space', label: 'Space', words: wordsOf(SPACE) },
  { id: 'countries', label: 'Countries', words: wordsOf(COUNTRIES) },
  { id: 'sports', label: 'Sports', words: wordsOf(SPORTS) },
  { id: 'music', label: 'Music', words: wordsOf(MUSIC) },
  { id: 'everyday', label: 'Around the house', words: wordsOf(EVERYDAY) }
]
