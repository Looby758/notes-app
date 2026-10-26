/** Colour themes. Shared so the main process can colour the native title-bar buttons to match. */

export interface ThemeColors {
  bg: string
  bgPanel: string
  bgRaised: string
  bgHover: string
  bgCode: string
  border: string
  borderStrong: string
  textStrong: string
  text: string
  textMuted: string
  textFaint: string
}

export interface Theme {
  id: string
  name: string
  colors: ThemeColors
  /** Accent used when you haven't picked your own. */
  accent: string
  /** A light theme (dark text on a light background). */
  light?: boolean
}

export const THEMES: Theme[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    accent: '#8b7cf6',
    colors: {
      bg: '#16171d',
      bgPanel: '#1b1c23',
      bgRaised: '#23242d',
      bgHover: '#2a2b35',
      bgCode: '#1c1d25',
      border: '#2a2b34',
      borderStrong: '#3a3b47',
      textStrong: '#eceef3',
      text: '#d7d9e0',
      textMuted: '#8a8e9a',
      textFaint: '#5e6270'
    }
  },
  {
    id: 'graphite',
    name: 'Graphite',
    accent: '#e0a458',
    colors: {
      bg: '#18181a',
      bgPanel: '#1e1e21',
      bgRaised: '#26262a',
      bgHover: '#2e2e33',
      bgCode: '#1f1f22',
      border: '#2c2c31',
      borderStrong: '#3d3d43',
      textStrong: '#f0f0f0',
      text: '#d9d9dc',
      textMuted: '#8e8e95',
      textFaint: '#606067'
    }
  },
  {
    id: 'nord',
    name: 'Nord Night',
    accent: '#88c0d0',
    colors: {
      bg: '#1f232b',
      bgPanel: '#242933',
      bgRaised: '#2e3440',
      bgHover: '#353c4a',
      bgCode: '#272c36',
      border: '#333a47',
      borderStrong: '#434c5e',
      textStrong: '#eceff4',
      text: '#d8dee9',
      textMuted: '#8f99ab',
      textFaint: '#626c7f'
    }
  },
  {
    id: 'deepblue',
    name: 'Deep Blue',
    accent: '#5ea8ff',
    colors: {
      bg: '#0f1522',
      bgPanel: '#131b2b',
      bgRaised: '#1a2438',
      bgHover: '#213049',
      bgCode: '#141d2e',
      border: '#1f2b42',
      borderStrong: '#2c3c5a',
      textStrong: '#eef3fb',
      text: '#d3dcec',
      textMuted: '#8394b0',
      textFaint: '#56657f'
    }
  },
  {
    id: 'oled',
    name: 'OLED Black',
    accent: '#a78bfa',
    colors: {
      bg: '#000000',
      bgPanel: '#08080a',
      bgRaised: '#141417',
      bgHover: '#1c1c20',
      bgCode: '#0c0c0f',
      border: '#1d1d22',
      borderStrong: '#2c2c33',
      textStrong: '#f4f4f6',
      text: '#d6d6db',
      textMuted: '#85858f',
      textFaint: '#56565f'
    }
  }
]

// Light themes: dark text on white, paper or warm sepia.
THEMES.push(
  {
    id: 'daylight',
    name: 'Daylight',
    light: true,
    accent: '#6d5ce8',
    colors: {
      bg: '#ffffff',
      bgPanel: '#f6f6f8',
      bgRaised: '#ffffff',
      bgHover: '#ececf1',
      bgCode: '#f4f4f7',
      border: '#e4e4ea',
      borderStrong: '#d2d2db',
      textStrong: '#14151a',
      text: '#2a2c33',
      textMuted: '#636773',
      textFaint: '#9a9daa'
    }
  },
  {
    id: 'paper',
    name: 'Paper',
    light: true,
    accent: '#2f7d5b',
    colors: {
      bg: '#fbfaf7',
      bgPanel: '#f3f1ec',
      bgRaised: '#ffffff',
      bgHover: '#e9e6df',
      bgCode: '#f1eee8',
      border: '#e3dfd6',
      borderStrong: '#d0cbc0',
      textStrong: '#1d1b17',
      text: '#33302a',
      textMuted: '#6e695f',
      textFaint: '#a29c90'
    }
  },
  {
    id: 'sepia',
    name: 'Sepia',
    light: true,
    accent: '#b4572e',
    colors: {
      bg: '#f4ecd8',
      bgPanel: '#ece2ca',
      bgRaised: '#f9f3e4',
      bgHover: '#e3d7ba',
      bgCode: '#ebe1c8',
      border: '#dccfb0',
      borderStrong: '#cbbb96',
      textStrong: '#2b2115',
      text: '#433625',
      textMuted: '#7a6a51',
      textFaint: '#a89878'
    }
  }
)

/** The theme in use: yours, or (when matching the system) your light or dark one. */
export function activeThemeId(p: { theme: string; followSystem: boolean; lightTheme: string; darkTheme: string }, systemDark: boolean): string {
  if (!p.followSystem) return p.theme
  return systemDark ? p.darkTheme : p.lightTheme
}

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
