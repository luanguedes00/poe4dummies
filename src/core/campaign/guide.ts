// O que fazer em cada área da campanha (PoE2), mostrado ao entrar na área.
// Fonte: maxroll, "Comprehensive League Start Leveling Guide", consultado em
// 30/09/2026 (patch 0.5). Nomes das áreas e chefes exatamente como no jogo
// (inglês); o resto em português. Revisar a cada patch.

export type TaskKind = 'reward' | 'boss' | 'optional' | 'info'

export interface ZoneTask {
  text: string
  kind: TaskKind
  /** Bônus permanente, pontos de passiva ou desbloqueio: não pode perder. */
  key?: boolean
}

export interface ZoneGuide {
  act: string
  /** Nome(s) da área como aparece no log do jogo. */
  names: string[]
  tasks: ZoneTask[]
}

export const GUIDE_SOURCE = { label: 'maxroll · leveling guide', url: 'https://maxroll.gg/poe2/getting-started/comprehensive-league-start-leveling-guide', date: '2026-09-30' }

const boss = (text: string, key = false): ZoneTask => ({ text, kind: 'boss', key })
const reward = (text: string): ZoneTask => ({ text, kind: 'reward', key: true })
const opt = (text: string): ZoneTask => ({ text, kind: 'optional' })
const info = (text: string): ZoneTask => ({ text, kind: 'info' })

export const CAMPAIGN_GUIDE: ZoneGuide[] = [
  // ---------------------------------------------------------------- Ato 1
  { act: '1', names: ['The Riverbank'], tasks: [boss('Mate o Bloated Miller')] },
  { act: '1', names: ['Clearfell Encampment'], tasks: [info('Pegue a gema de skill com o Renly e confira o vendedor')] },
  { act: '1', names: ['Clearfell'], tasks: [boss('Mate a Beira of the Rotten Pack'), reward('+10% de resistência a frio (permanente)'), opt('Baú escondido com Uncut Skill Gem'), info('Ative o waypoint')] },
  { act: '1', names: ['The Mud Burrow'], tasks: [opt('Chefe The Devourer: Uncut Skill Gem'), info('Volte à cidade para pegar a Uncut Support Gem da missão')] },
  { act: '1', names: ['The Grelwood'], tasks: [opt('Cabana da bruxa: frascos e a chefe Areagne'), opt('Chefe Brambleghast'), info('Ative os três altares na The Red Vale e volte com o Una para a Tree of Souls'), info('Ative o waypoint')] },
  { act: '1', names: ['The Red Vale'], tasks: [info('Ative os três altares'), boss('Mate o The Rust King'), info('Leve os itens ao Renly')] },
  { act: '1', names: ['The Grim Tangle'], tasks: [opt('Chefe The Rotten Druid: Uncut Support Gem')] },
  { act: '1', names: ['Cemetery of the Eternals', 'Mausoleum of the Praetor', 'Tomb of the Consort'], tasks: [info('Faça as duas masmorras: Mausoleum of the Praetor e Tomb of the Consort'), boss('Mate o Lachlann of Endless Lament'), opt('Ancient Ruins Grave Site: anel aleatório')] },
  { act: '1', names: ['The Hunting Grounds'], tasks: [boss('Mate o The Crowbell'), reward('+2 pontos de passiva'), opt('Ritual Site: Uncut Skill Gem nível 4')] },
  { act: '1', names: ['Freythorn'], tasks: [info('Complete os rituais'), boss('Mate o The King in the Mists'), reward('+30 de Spirit (permanente)'), info('Escolha o charm de recompensa')] },
  { act: '1', names: ['Ogham Farmlands'], tasks: [info("Pegue a Una's Lute"), reward('+2 pontos de passiva (ao entregar a Lute)'), opt('Feral Mutt raro: Uncut Skill Gem')] },
  { act: '1', names: ['Ogham Village'], tasks: [boss('Mate o The Executioner')] },
  { act: '1', names: ['The Manor Ramparts'], tasks: [boss('Mate o Candlemass'), reward('+20 de vida máxima (permanente)'), opt('Hanged Man na forca: Uncut Support Gem')] },
  { act: '1', names: ['Ogham Manor'], tasks: [boss('Mate o Count Ogham (fim do Ato 1)')] },

  // ---------------------------------------------------------------- Ato 2
  { act: '2', names: ['Vastiri Outskirts'], tasks: [boss('Mate o Rathbreaker')] },
  { act: '2', names: ['Ardura Caravan'], tasks: [info('Fale com Risu e Asala')] },
  { act: '2', names: ['Mawdun Quarry'], tasks: [info('Antes do Rudja: vendedores com frascos grandes e botas de 15% de velocidade; leve resistência a fogo alta')] },
  { act: '2', names: ['Mawdun Mine'], tasks: [boss('Mate o Rudja, the Dread Engineer'), info('Liberte o Risu')] },
  { act: '2', names: ['Halani Gates'], tasks: [boss('Mate o Jamanra'), opt("L'im the Impaler"), info('Uncut Skill Gem nível 7')] },
  { act: '2', names: ["Traitor's Passage"], tasks: [boss('Mate a Balbala, the Traitor'), reward("Balbala's Barya: leve ao Trial of the Sekhemas (ascendência)")] },
  { act: '2', names: ['Trial of the Sekhemas'], tasks: [boss('Mate o Rattlecage, the Earthbreaker'), reward('Libera a ascendência')] },
  { act: '2', names: ['Keth'], tasks: [boss('Mate a Kabala, Constrictor Queen'), reward('+2 pontos de passiva'), opt('Abandoned Shrine: amuleto mágico garantido')] },
  { act: '2', names: ['The Lost City', 'Lost City'], tasks: [opt('Golden Chest: Uncut Spirit Gem'), opt('Gilded Beetle: joia aleatória')] },
  { act: '2', names: ['Buried Shrines'], tasks: [boss('Mate o Azarian the Forsaken Son'), info('Elemental Offering: anel de resistência'), opt('Guarded Sarcophagus: Uncut Support Gem')] },
  { act: '2', names: ['Mastodon Badlands'], tasks: [opt('Shrine of Bones: Uncut Support Gem')] },
  { act: '2', names: ['The Lightless Passage'], tasks: [reward('Well of Souls: libera o crafting Desecrated (Abyss)')] },
  { act: '2', names: ['The Bone Pits'], tasks: [boss('Mate Iktab e Ekbab'), info('Pegue a Sun Clan Relic')] },
  { act: '2', names: ['Valley of the Titans', 'The Valley of the Titans'], tasks: [reward('Coloque a relíquia no altar: bônus permanente (dá para trocar depois)')] },
  { act: '2', names: ['Titan Grotto', 'The Titan Grotto'], tasks: [boss('Mate o Zalmarath, the Colossus')] },
  { act: '2', names: ['Deshar'], tasks: [info('Pegue a Final Letter')] },
  { act: '2', names: ['Path of Mourning'], tasks: [info('Entregue a carta ao Shambrin'), reward('+2 pontos de passiva'), opt('Evento Shifting Vases: Uncut Support Gem')] },
  { act: '2', names: ['The Spires of Deshar'], tasks: [boss('Mate o Tor Gul, the Defiler'), reward('Ative o santuário: +10% de resistência a raio (permanente)')] },
  { act: '2', names: ['The Dreadnought'], tasks: [opt('Bom lugar para farmar XP se estiver abaixo do nível')] },
  { act: '2', names: ['Dreadnought Vanguard'], tasks: [boss('Mate o Jamanra, the Abomination (fim do Ato 2)')] },

  // ---------------------------------------------------------------- Ato 3
  { act: '3', names: ['Sandswept Marsh'], tasks: [opt('Chefe Rootdredge: Uncut Skill Gem nível 9'), info('Acampamento Orok: Jeweller\'s Orb no cesto'), opt('Hanging Tree: anel mágico aleatório')] },
  { act: '3', names: ['Ziggurat Encampment'], tasks: [info('Fale com Alva e Oswald; compras')] },
  { act: '3', names: ['Jungle Ruins'], tasks: [boss('Mate o Silverfist'), reward('+2 pontos de passiva'), opt('Loja da Gwendolyn Albright: armaduras melhores')] },
  { act: '3', names: ['The Venom Crypts', 'Venom Crypts'], tasks: [reward('Corpse-snake Venom: bônus permanente (escolha definitiva)')] },
  { act: '3', names: ['Infested Barrens'], tasks: [info('Chame a Alva: botas raras garantidas'), opt('Acampamento do Sebastian Carroway: armas melhores')] },
  { act: '3', names: ['Chimeral Wetlands'], tasks: [boss('Mate o Xyclucian, the Chimera'), info('Chimeral Inscribed Ultimatum')] },
  { act: '3', names: ["Jiquani's Machinarium"], tasks: [info('Pegue os Soul Cores'), boss('Mate o Blackjaw'), reward('+10% de resistência a fogo (permanente)')] },
  { act: '3', names: ["Jiquani's Sanctum"], tasks: [boss('Mate o Zicoatl, Warden of the Core'), info('Large Soul Core'), opt('Altar de corrupção: arrisque corromper um item')] },
  { act: '3', names: ['The Matlan Waterways'], tasks: [info('Ative as alavancas: waypoint para a Drowned City')] },
  { act: '3', names: ['The Azak Bog'], tasks: [boss('Mate a Ignagduk, the Bog Witch'), reward('+30 de Spirit (permanente)'), info('Uncut Spirit Gem e um charm'), opt('Flameskin Ritual: resistência a fogo temporária, se faltar')] },
  { act: '3', names: ['Trial of Chaos'], tasks: [boss('Vença o chefe do teste'), reward('Pontos de ascendência 3 e 4')] },
  { act: '3', names: ['The Molten Vault'], tasks: [boss('Mate o Mektul, the Forgemaster'), reward('Libera a Reforging Bench'), info('Uncut Skill Gem nível 10')] },
  { act: '3', names: ['The Apex of Filth'], tasks: [boss('Mate a Queen of Filth'), info('Caldeirão de cogumelos: frascos com qualidade; Temple Door Idol'), opt('Cauldron Keeper: joias e itens de conjurador')] },
  { act: '3', names: ['Temple of Kopec'], tasks: [boss('Mate o Ketzuil, High Priest of the Sun'), opt('Leap Slam sobre o vão: atalho')] },
  { act: '3', names: ['Utzaal'], tasks: [boss('Mate a Viper Napuatzi')] },
  { act: '3', names: ['Aggorat'], tasks: [info('Sacrifique o coração no altar'), reward('+2 pontos de passiva')] },
  { act: '3', names: ['The Black Chambers'], tasks: [boss('Mate o Doryani, Royal Thaumaturge (fim do Ato 3)')] },

  // ---------------------------------------------------------------- Ato 4
  // Rota das ilhas (ninguém sabe a ordem): fonte domistae.github.io/poe2-leveling (patch 0.5.5), 30/09/2026.
  {
    act: '4',
    names: ['Kingsmarch'],
    tasks: [
      info('Rota das ilhas (as 4 primeiras dão os pedaços do mapa):'),
      info('1. Whakapanu Island (Shark Fin: bônus permanente)'),
      info('2. Shrike Island'),
      info('3. Abandoned Prison'),
      info('4. Isle of Kin → Volcanic Warrens'),
      info('5. Eye of Hinekora (+mana máxima)'),
      info('6. Halls of the Dead (tatuagem: escolha resistência)'),
      info('7. Trial of the Ancestors (+2 passivas)'),
      info("8. Kedge Bay → Journey's End"),
      info("9. Plunder's Point (precisa dos 4 pedaços)"),
      info('10. Arastas → The Excavation → Ngakanu (por último)'),
    ],
  },
  { act: '4', names: ['Whakapanu Island', 'Singing Caverns'], tasks: [boss('Mate o chefe das Singing Caverns'), reward('Shark Fin: bônus defensivo permanente')] },
  { act: '4', names: ['Shrike Island'], tasks: [boss('Mate o Scourge of the Skies'), info('Torn Map Piece')] },
  { act: '4', names: ['Abandoned Prison'], tasks: [reward('Estátua da Goddess of Justice: bônus permanente de recuperação de frasco')] },
  { act: '4', names: ['Kedge Bay', "Journey's End"], tasks: [boss('Mate Captain Hartlin e Omniphobia, Fear Manifest'), reward('+2 pontos de passiva do set de armas')] },
  { act: '4', names: ['Isle of Kin', 'Volcanic Warrens'], tasks: [boss('Mate o Krutog, Lord of Kin'), info('Torn Map Piece'), opt('The Blind Beast: Blank Greater Rune')] },
  { act: '4', names: ["Plunder's Point"], tasks: [reward('Complete a Expedition: libera o Runeforging')] },
  { act: '4', names: ['Eye of Hinekora', 'Silent Hall'], tasks: [reward('Preste respeito no Silent Hall: +5% de mana máxima (permanente)')] },
  { act: '4', names: ['Halls of the Dead'], tasks: [info("Três testes: Tawhoa's, Tasalio's e Ngamahu's"), reward('Cada um: +5 de atributo ou +5% de resistência (permanente, 3 vezes)')] },
  { act: '4', names: ['Trial of the Ancestors'], tasks: [boss('Mate o Yama the White'), reward('+2 pontos de passiva do set de armas')] },
  { act: '4', names: ['Arastas'], tasks: [opt('Junte os sinos: currency de craft (Regal Orbs etc.)')] },

  // ---------------------------------------------------------------- Interlúdios
  // Interlúdio 1: The Curse of Holten. Fonte extra: maxroll "Campaign Walkthrough" (30/09/2026).
  { act: 'Interlúdio 1', names: ['Scorched Farmlands'], tasks: [boss('Mate Isolde of the White Shroud e Heldra of the Black Pyre')] },
  { act: 'Interlúdio 1', names: ['Stones of Serle'], tasks: [boss('Mate a Siora, Blade of the Mists')] },
  { act: 'Interlúdio 1', names: ['Holten'], tasks: [boss('Mate o Sigbert of the Sullied Oath'), opt('Godwin of the Shattered Creed'), opt('Ferryman vende Greater Runes (compra única, ~20.000 de gold)')] },
  { act: 'Interlúdio 1', names: ['Wolvenhold'], tasks: [boss('Mate o Oswin, the Dread Warden'), reward('+2 pontos de passiva do set de armas')] },
  { act: 'Interlúdio 1', names: ['Holten Estate'], tasks: [boss('Mate Thane Wulfric e Lady Elyswyth')] },
  // Interlúdio 2: The Stolen Barya.
  { act: 'Interlúdio 2', names: ['The Khari Crossing'], tasks: [boss('Mate Akthi, the Final Sting e Anundr, the Sandworm'), reward("Molten One's Gift: +5% de vida máxima"), reward('+2 pontos de passiva do set de armas (com a Risu)')] },
  { act: 'Interlúdio 2', names: ['Sel Khari Sanctuary'], tasks: [boss('Mate o Elzarah, the Cobra Lord'), opt('Liberte os Djinns com as Baryas: joias e acessórios raros')] },
  { act: 'Interlúdio 2', names: ['The Galai Gates'], tasks: [boss('Mate o Vornas, the Fell Flame: libera a entrada de Qimah')] },
  { act: 'Interlúdio 2', names: ['Qimah'], tasks: [reward("Ative os Orbala's Pillars: bônus permanente (dá para trocar)"), info('No começo, prefira resistências ou atributos')] },
  { act: 'Interlúdio 2', names: ['Qimah Reservoir'], tasks: [boss('Mate o Azmadi, the Faridun Prince')] },
  // Interlúdio 3: Doryani's Contingency. Fontes: maxroll e poe-vault (Kriar Interlude Boss Guide), 01/10/2026.
  { act: 'Interlúdio 3', names: ['Kriar Village'], tasks: [boss('Mate a Lythara, the Wayward Spear'), reward('Gemcrust Skull: +40 de Spirit (permanente)'), info('Uncut Spirit Gem')] },
  { act: 'Interlúdio 3', names: ['Howling Caves'], tasks: [boss('Mate o The Abominable Yeti'), info('Entregue as Icy Tusks à Hilda'), reward('+2 pontos de passiva do set de armas')] },
  { act: 'Interlúdio 3', names: ['Glacial Tarn'], tasks: [boss('Mate o Rakkar, the Frozen Talon')] },
  { act: 'Interlúdio 3', names: ['Etched Ravine'], tasks: [boss('Mate o Stormgore, the Guardian')] },
  { act: 'Interlúdio 3', names: ['The Cuachic Vault', 'Cuachic Vault'], tasks: [boss('Mate Zelina, Blood Priestess e Zolin, Blood Priest')] },
  { act: 'Interlúdio 3', names: ['Kriar Peaks'], tasks: [info('Elder Maddox: escolha um item único')] },
]

const normalize = (name: string) => name.toLowerCase().replace(/^the\s+/, '').replace(/[’']/g, "'").trim()
const INDEX = new Map(CAMPAIGN_GUIDE.flatMap((z) => z.names.map((n) => [normalize(n), z] as const)))

/** Guia da área pelo nome que o jogo escreveu no log (ignora "The" e maiúsculas). */
export function zoneGuide(areaName: string | null | undefined): ZoneGuide | null {
  if (!areaName) return null
  return INDEX.get(normalize(areaName)) ?? null
}
