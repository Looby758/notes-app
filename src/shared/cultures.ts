/**
 * Local flavour for survival areas around the world: the names people have, what towns are called,
 * and what the buildings are called. Everything here is made up or generic; nothing is a real place
 * except the famous cities on the globe.
 */

export type CultureId = 'us' | 'uk' | 'fr' | 'de' | 'es' | 'it' | 'pt' | 'jp' | 'en'

export type BuildingWord = 'store' | 'pharmacy' | 'police' | 'church' | 'school' | 'warehouse' | 'gas' | 'house' | 'farm'

export interface Culture {
  id: CultureId
  first: { f: readonly string[]; m: readonly string[] }
  last: readonly string[]
  towns: readonly string[]
  /** A building's name, from the town it's in (or a surname for houses and farms). */
  building: (kind: BuildingWord, town: string, r: () => number) => string
}

const pickWith = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)]

const US: Culture = {
  id: 'us',
  first: {
    f: ['Maggie', 'Carol', 'Michonne', 'Tara', 'Rosita', 'Sasha', 'Beth', 'Andrea', 'Amy', 'Lori', 'Nora', 'Priya', 'Elena', 'Hannah', 'Grace', 'Ivy', 'Dana', 'Rhea', 'June', 'Tess', 'Lena', 'Mae', 'Nina', 'Bea', 'Ada', 'Lucy', 'Paige', 'Wendy', 'Kara', 'Della', 'Sam', 'Rose', 'Clara', 'Josie', 'Maya'],
    m: ['Rick', 'Glenn', 'Daryl', 'Abraham', 'Eugene', 'Aaron', 'Tyreese', 'Hershel', 'Dale', 'Shane', 'Morgan', 'Jesus', 'Ezekiel', 'Jerry', 'Owen', 'Marcus', 'Jamal', 'Luis', 'Theo', 'Caleb', 'Wes', 'Omar', 'Felix', 'Ray', 'Hank', 'Cole', 'Victor', 'Reggie', 'Darnell', 'Gus', 'Eli', 'Boone', 'Sam', 'Noah', 'Jack']
  },
  last: ['Walsh', 'Dixon', 'Greene', 'Porter', 'Hale', 'Monroe', 'Reyes', 'Tate', 'Brooks', 'Vance', 'Carver', 'Mercer', 'Holt', 'Bishop', 'Shaw', 'Fuller', 'Pryor', 'Lyle', 'Booker', 'Caine', 'Dunn', 'Ellis', 'Foster', 'Gaines', 'Harmon', 'Ingram', 'Jett', 'Keller', 'Lowry', 'Mays', 'Nash', 'Odom', 'Pike', 'Quinn', 'Rowe', 'Sutter', 'Toomey'],
  towns: ['Harlow Springs', 'Cedar Ford', 'Millbrook', 'Pine Hollow', 'Ashby', 'Wrens Mill', 'Laurel Creek', 'Greer Crossing', 'Fairhaven', 'Stone Gap', 'Briar Ridge', 'Copper Bend', 'Maple Fork', 'Elk Run'],
  building: (kind, t, r) => {
    switch (kind) {
      case 'store':
        return `${t} Grocery`
      case 'pharmacy':
        return `${t} Pharmacy`
      case 'police':
        return `${t} Police Station`
      case 'church':
        return `${pickWith(r, ['First Baptist', 'St. Mark’s', 'Grace Methodist', 'Calvary'])} Church`
      case 'school':
        return `${t} ${pickWith(r, ['High School', 'Elementary', 'Middle School'])}`
      case 'warehouse':
        return `${t} ${pickWith(r, ['Feed & Supply', 'Lumber Yard', 'Distribution Center'])}`
      case 'gas':
        return `${pickWith(r, ['Route 9', 'Hwy 41', 'Crossroads', 'Old Mill'])} Gas`
      case 'house':
        return `${t} house`
      case 'farm':
        return `${t} farm`
    }
  }
}

const UK: Culture = {
  id: 'uk',
  first: {
    f: ['Emma', 'Sophie', 'Charlotte', 'Amelia', 'Olivia', 'Isla', 'Grace', 'Lucy', 'Hannah', 'Megan', 'Chloe', 'Ellie', 'Freya', 'Holly', 'Imogen', 'Jess', 'Kate', 'Molly', 'Niamh', 'Poppy', 'Rosie', 'Zara'],
    m: ['Oliver', 'Harry', 'George', 'Jack', 'Charlie', 'Alfie', 'Callum', 'Dylan', 'Ewan', 'Finn', 'Harvey', 'Jamie', 'Kieran', 'Liam', 'Mason', 'Nathan', 'Owen', 'Reece', 'Rhys', 'Toby', 'Will', 'Arthur']
  },
  last: ['Smith', 'Jones', 'Taylor', 'Davies', 'Evans', 'Wilson', 'Thomas', 'Roberts', 'Walker', 'Wright', 'Hughes', 'Green', 'Hall', 'Wood', 'Clarke', 'Turner', 'Hill', 'Cooper', 'Ward', 'Morris', 'Price', 'Bell', 'Fletcher', 'Marsh'],
  towns: ['Ashcombe', 'Little Brampton', 'Kingsmere', 'Wexley', 'Barrowfield', 'Hollingford', 'Upper Stow', 'Thornbury Cross', 'Elmsworth', 'Fenwick', 'Haddon Vale', 'Marlow End'],
  building: (kind, t, r) => {
    switch (kind) {
      case 'store':
        return `${t} Co-op`
      case 'pharmacy':
        return `${t} Chemist`
      case 'police':
        return `${t} Police Station`
      case 'church':
        return `St ${pickWith(r, ['Mary’s', 'Michael’s', 'Peter’s', 'Andrew’s'])} Church`
      case 'school':
        return `${t} ${pickWith(r, ['Academy', 'Primary School', 'Grammar School'])}`
      case 'warehouse':
        return `${t} ${pickWith(r, ['Depot', 'Builders’ Merchant', 'Distribution Centre'])}`
      case 'gas':
        return `${pickWith(r, ['A38', 'A1', 'Ring Road', 'Moorside'])} Services`
      case 'house':
        return `${t} cottage`
      case 'farm':
        return `${t} Farm`
    }
  }
}

const FR: Culture = {
  id: 'fr',
  first: {
    f: ['Camille', 'Léa', 'Chloé', 'Manon', 'Inès', 'Sarah', 'Julie', 'Claire', 'Élodie', 'Margaux', 'Lucie', 'Amélie', 'Anaïs', 'Juliette', 'Océane', 'Pauline', 'Noémie', 'Céline', 'Hélène', 'Agathe'],
    m: ['Lucas', 'Hugo', 'Louis', 'Théo', 'Antoine', 'Julien', 'Mathis', 'Nicolas', 'Maxime', 'Baptiste', 'Clément', 'Étienne', 'Florian', 'Gaël', 'Jérôme', 'Karim', 'Loïc', 'Mathieu', 'Olivier', 'Rémi', 'Thomas', 'Yanis']
  },
  last: ['Martin', 'Bernard', 'Dubois', 'Durand', 'Lefebvre', 'Moreau', 'Laurent', 'Girard', 'Roux', 'Fournier', 'Morel', 'Mercier', 'Blanc', 'Garnier', 'Chevalier', 'Faure', 'Rousseau', 'Lambert', 'Bonnet', 'Fontaine', 'Perrin', 'Marchand'],
  towns: ['Saint-Aubin-sur-Loire', 'Montclair', 'Villeneuve-les-Prés', 'Beaumont', 'La Roche-Vieille', 'Fontenay', 'Vaudreuil', 'Saint-Martin-des-Champs', 'Belval', 'Château-Rivière', 'Les Ormes', 'Valmont'],
  building: (kind, t, r) => {
    switch (kind) {
      case 'store':
        return `Supermarché de ${t}`
      case 'pharmacy':
        return `Pharmacie de ${t}`
      case 'police':
        return `Gendarmerie de ${t}`
      case 'church':
        return `Église ${pickWith(r, ['Saint-Pierre', 'Notre-Dame', 'Saint-Martin', 'Sainte-Anne'])}`
      case 'school':
        return `${pickWith(r, ['Lycée', 'Collège', 'École'])} de ${t}`
      case 'warehouse':
        return `${pickWith(r, ['Entrepôt', 'Coopérative agricole', 'Dépôt'])} de ${t}`
      case 'gas':
        return `Station ${pickWith(r, ['de la N7', 'du Carrefour', 'des Platanes', 'de l’Autoroute'])}`
      case 'house':
        return `Maison ${t}`
      case 'farm':
        return `Ferme ${t}`
    }
  }
}

const DE: Culture = {
  id: 'de',
  first: {
    f: ['Anna', 'Lena', 'Lea', 'Hannah', 'Laura', 'Julia', 'Sophie', 'Marie', 'Katharina', 'Johanna', 'Greta', 'Clara', 'Frieda', 'Ida', 'Nele', 'Paula', 'Svenja', 'Ute', 'Jana', 'Mia'],
    m: ['Lukas', 'Jonas', 'Leon', 'Felix', 'Paul', 'Maximilian', 'Tim', 'Niklas', 'Jan', 'Tobias', 'Stefan', 'Matthias', 'Florian', 'Sebastian', 'Moritz', 'Jannik', 'Kai', 'Dieter', 'Klaus', 'Emil']
  },
  last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Koch', 'Richter', 'Klein', 'Wolf', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hartmann', 'Lange', 'Werner'],
  towns: ['Altenbach', 'Birkenfeld', 'Eichstadt', 'Grünwald', 'Hohenau', 'Lindenberg', 'Neudorf', 'Rosenheim am See', 'Steinach', 'Waldkirchen', 'Tannhausen', 'Mühlbach'],
  building: (kind, t, r) => {
    switch (kind) {
      case 'store':
        return `${t} Supermarkt`
      case 'pharmacy':
        return `${pickWith(r, ['Stadt', 'Linden', 'Adler'])}-Apotheke`
      case 'police':
        return `Polizei ${t}`
      case 'church':
        return `${pickWith(r, ['St.-Marien', 'St.-Johannes', 'St.-Nikolai', 'Martin-Luther'])}-Kirche`
      case 'school':
        return `${pickWith(r, ['Gymnasium', 'Grundschule', 'Realschule'])} ${t}`
      case 'warehouse':
        return `${pickWith(r, ['Lager', 'Baumarkt', 'Logistikzentrum'])} ${t}`
      case 'gas':
        return `Tankstelle ${pickWith(r, ['an der B27', 'am Kreisel', 'Nord', 'an der A7'])}`
      case 'house':
        return `Haus ${t}`
      case 'farm':
        return `Hof ${t}`
    }
  }
}

const ES: Culture = {
  id: 'es',
  first: {
    f: ['Lucía', 'María', 'Paula', 'Sofía', 'Carmen', 'Elena', 'Marta', 'Laura', 'Alba', 'Sara', 'Daniela', 'Valeria', 'Ana', 'Isabel', 'Rocío', 'Pilar', 'Nuria', 'Inés', 'Ximena', 'Camila'],
    m: ['Hugo', 'Pablo', 'Mateo', 'Álvaro', 'Diego', 'Javier', 'Sergio', 'Carlos', 'Manuel', 'Raúl', 'Iker', 'Adrián', 'Andrés', 'Luis', 'Miguel', 'Rafael', 'Tomás', 'Joaquín', 'Santiago', 'Emilio']
  },
  last: ['García', 'Fernández', 'González', 'Rodríguez', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Díaz', 'Moreno', 'Álvarez', 'Romero', 'Navarro', 'Torres', 'Ramos', 'Gil', 'Ortega', 'Castro', 'Vega', 'Herrera', 'Molina'],
  towns: ['San Martín del Río', 'Villaverde', 'Santa Cruz de la Sierra Alta', 'Los Olivos', 'Fuentealta', 'Valdeprado', 'El Pinar', 'Torrealba', 'Peñaflor', 'Navaluenga', 'Monteverde', 'La Cañada'],
  building: (kind, t, r) => {
    switch (kind) {
      case 'store':
        return `Supermercado ${t}`
      case 'pharmacy':
        return `Farmacia ${t}`
      case 'police':
        return `Comisaría de ${t}`
      case 'church':
        return `Iglesia de ${pickWith(r, ['San Juan', 'Santa María', 'San Pedro', 'la Asunción'])}`
      case 'school':
        return `${pickWith(r, ['Colegio', 'Instituto', 'Escuela'])} ${t}`
      case 'warehouse':
        return `${pickWith(r, ['Almacén', 'Cooperativa', 'Nave'])} de ${t}`
      case 'gas':
        return `Gasolinera ${pickWith(r, ['de la N-IV', 'del Cruce', 'El Molino', 'La Ronda'])}`
      case 'house':
        return `Casa ${t}`
      case 'farm':
        return `Granja ${t}`
    }
  }
}

const IT: Culture = {
  id: 'it',
  first: {
    f: ['Giulia', 'Sofia', 'Aurora', 'Alice', 'Ginevra', 'Emma', 'Giorgia', 'Martina', 'Chiara', 'Francesca', 'Elisa', 'Sara', 'Valentina', 'Federica', 'Beatrice', 'Ilaria', 'Lucia', 'Paola', 'Silvia', 'Marta'],
    m: ['Leonardo', 'Francesco', 'Alessandro', 'Lorenzo', 'Mattia', 'Andrea', 'Gabriele', 'Riccardo', 'Tommaso', 'Edoardo', 'Marco', 'Luca', 'Giovanni', 'Stefano', 'Davide', 'Paolo', 'Simone', 'Fabio', 'Matteo', 'Pietro']
  },
  last: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana'],
  towns: ['San Vito al Monte', 'Castelnuovo', 'Borgo Fiorito', 'Montevecchio', 'Villafranca Alta', 'Roccabella', 'Pontevalle', 'Santa Lucia', 'Collerotondo', 'Acquaviva', 'Torre del Lago Piccolo', 'Valdoro'],
  building: (kind, t, r) => {
    switch (kind) {
      case 'store':
        return `Supermercato ${t}`
      case 'pharmacy':
        return `Farmacia ${t}`
      case 'police':
        return `Carabinieri ${t}`
      case 'church':
        return `Chiesa di ${pickWith(r, ['San Giorgio', 'Santa Maria', 'San Francesco', 'San Rocco'])}`
      case 'school':
        return `${pickWith(r, ['Liceo', 'Scuola Media', 'Scuola Elementare'])} ${t}`
      case 'warehouse':
        return `${pickWith(r, ['Magazzino', 'Consorzio Agrario', 'Deposito'])} ${t}`
      case 'gas':
        return `Distributore ${pickWith(r, ['della Statale', 'al Bivio', 'San Marco', 'dell’Autostrada'])}`
      case 'house':
        return `Casa ${t}`
      case 'farm':
        return `Cascina ${t}`
    }
  }
}

const PT: Culture = {
  id: 'pt',
  first: {
    f: ['Ana', 'Beatriz', 'Mariana', 'Júlia', 'Larissa', 'Fernanda', 'Gabriela', 'Camila', 'Leticia', 'Rafaela', 'Inês', 'Carolina', 'Bianca', 'Luana', 'Tatiana', 'Joana'],
    m: ['João', 'Pedro', 'Lucas', 'Gabriel', 'Rafael', 'Thiago', 'Bruno', 'Felipe', 'Diogo', 'Rodrigo', 'Tiago', 'Gustavo', 'Caio', 'Henrique', 'Vinícius', 'Mateus']
  },
  last: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Pereira', 'Costa', 'Rodrigues', 'Almeida', 'Nascimento', 'Lima', 'Araújo', 'Fernandes', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Ribeiro', 'Barbosa'],
  towns: ['São Bento do Vale', 'Boa Vista', 'Santa Rita', 'Vila Nova', 'Campo Alegre', 'Rio Claro do Norte', 'Pedra Branca', 'Lagoa Seca', 'Monte Alto', 'Porto Velho de Cima'],
  building: (kind, t, r) => {
    switch (kind) {
      case 'store':
        return `Mercado ${t}`
      case 'pharmacy':
        return `Farmácia ${t}`
      case 'police':
        return `Delegacia de ${t}`
      case 'church':
        return `Igreja de ${pickWith(r, ['São José', 'Nossa Senhora', 'Santo Antônio', 'São Pedro'])}`
      case 'school':
        return `Escola ${t}`
      case 'warehouse':
        return `${pickWith(r, ['Armazém', 'Depósito', 'Cooperativa'])} ${t}`
      case 'gas':
        return `Posto ${pickWith(r, ['da BR', 'do Trevo', 'Central', 'da Serra'])}`
      case 'house':
        return `Casa ${t}`
      case 'farm':
        return `Fazenda ${t}`
    }
  }
}

const JP: Culture = {
  id: 'jp',
  first: {
    f: ['Yui', 'Haruka', 'Aoi', 'Sakura', 'Rin', 'Mei', 'Hina', 'Yuna', 'Misaki', 'Nanami', 'Ayaka', 'Emi', 'Keiko', 'Mika', 'Natsuki', 'Rei'],
    m: ['Haruto', 'Ren', 'Sota', 'Yuto', 'Kaito', 'Riku', 'Takumi', 'Daiki', 'Kenji', 'Hiroshi', 'Shota', 'Yusuke', 'Kazuki', 'Ryo', 'Taro', 'Kenta']
  },
  last: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada', 'Sasaki', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Shimizu'],
  towns: ['Higashiyama', 'Kawanishi', 'Midorigaoka', 'Asahimachi', 'Sakuragawa', 'Kitamura', 'Minamihara', 'Yamanaka', 'Hoshino', 'Aoba'],
  building: (kind, t, r) => {
    switch (kind) {
      case 'store':
        return `${t} Supermarket`
      case 'pharmacy':
        return `${t} Drugstore`
      case 'police':
        return `${t} Koban`
      case 'church':
        return `${t} ${pickWith(r, ['Shrine', 'Temple'])}`
      case 'school':
        return `${t} ${pickWith(r, ['High School', 'Elementary School', 'Junior High'])}`
      case 'warehouse':
        return `${t} ${pickWith(r, ['Warehouse', 'Logistics Center', 'Hardware Store'])}`
      case 'gas':
        return `${pickWith(r, ['Route 1', 'Route 16', 'Station-mae', 'Bypass'])} Gas`
      case 'house':
        return `${t} house`
      case 'farm':
        return `${t} farm`
    }
  }
}

/** English names without anything American about the buildings: for places with no list of their own. */
const EN: Culture = {
  ...US,
  id: 'en',
  towns: ['Northgate', 'Riverside', 'Hillcrest', 'Westbrook', 'Eastfield', 'Lakeview', 'Old Town', 'Southport', 'Greenhill', 'Bridgeton'],
  building: (kind, t, r) => {
    switch (kind) {
      case 'church':
        return `${t} ${pickWith(r, ['Church', 'Chapel', 'Temple'])}`
      case 'school':
        return `${t} School`
      case 'gas':
        return `${pickWith(r, ['Highway', 'Crossroads', 'North Road', 'Bypass'])} Fuel`
      default:
        return US.building(kind, t, r)
    }
  }
}

export const CULTURES: Record<CultureId, Culture> = { us: US, uk: UK, fr: FR, de: DE, es: ES, it: IT, pt: PT, jp: JP, en: EN }

export const cultureOf = (id: string | undefined): Culture => CULTURES[(id ?? 'us') as CultureId] ?? US
