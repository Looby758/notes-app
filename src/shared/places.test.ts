import { describe, expect, it } from 'vitest'
import { isMapsUrl, mapsUrl, parseMapsUrl, parsePlaceLine, placeMarkdown, placesFromSearch, tileAt } from './places'

const tower = { name: 'Eiffel Tower', address: 'Avenue Gustave Eiffel, Paris, France', lat: 48.8582602, lon: 2.2944991 }

describe('place links', () => {
  it('links to Google Maps by coordinates, with the address as the title', () => {
    expect(mapsUrl(tower)).toBe('https://www.google.com/maps/search/?api=1&query=48.8582602,2.2944991')
    expect(placeMarkdown(tower)).toBe(
      '[📍 Eiffel Tower](https://www.google.com/maps/search/?api=1&query=48.8582602,2.2944991 "Avenue Gustave Eiffel, Paris, France")'
    )
  })

  it('links a plain search when there are no coordinates', () => {
    expect(placeMarkdown({ name: 'pizza near me', query: 'pizza near me' })).toBe(
      '[📍 pizza near me](https://www.google.com/maps/search/?api=1&query=pizza%20near%20me)'
    )
  })

  it("keeps brackets and quotes from breaking the link", () => {
    const md = placeMarkdown({ name: 'Café [Old]', address: 'The "Old" Lane', lat: 1, lon: 2 })
    expect(md).toBe(`[📍 Café (Old)](https://www.google.com/maps/search/?api=1&query=1,2 "The 'Old' Lane")`)
    expect(parsePlaceLine(md)).toMatchObject({ name: 'Café (Old)', address: "The 'Old' Lane", target: { lat: 1, lon: 2 } })
  })
})

describe('reading Google Maps links', () => {
  it('knows which links are Google Maps', () => {
    expect(isMapsUrl('https://www.google.com/maps/place/Big+Ben')).toBe(true)
    expect(isMapsUrl('https://www.google.co.uk/maps/@51.5,-0.12,15z')).toBe(true)
    expect(isMapsUrl('https://maps.google.com/?q=Paris')).toBe(true)
    expect(isMapsUrl('https://maps.app.goo.gl/abc123')).toBe(true)
    expect(isMapsUrl('https://www.google.com/search?q=maps')).toBe(false)
    expect(isMapsUrl('https://example.com/maps')).toBe(false)
  })

  it('finds the coordinates in the usual kinds of link', () => {
    expect(parseMapsUrl(mapsUrl(tower))).toEqual({ lat: 48.8582602, lon: 2.2944991 })
    expect(parseMapsUrl('https://maps.google.com/?q=51.5007,-0.1246')).toEqual({ lat: 51.5007, lon: -0.1246 })
    expect(parseMapsUrl('https://www.google.com/maps/@51.5,-0.12,15z')).toEqual({ lat: 51.5, lon: -0.12 })
  })

  it("prefers a place page's own pin to where the map was looking", () => {
    const url = 'https://www.google.com/maps/place/Big+Ben/@51.5,-0.13,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d51.5007292!4d-0.1246254'
    expect(parseMapsUrl(url)).toEqual({ query: 'Big Ben', lat: 51.5007292, lon: -0.1246254 })
  })

  it('keeps what was searched for when there are no coordinates', () => {
    expect(parseMapsUrl('https://maps.google.com/?q=Tower+of+London')).toEqual({ query: 'Tower of London' })
    expect(parseMapsUrl('https://maps.app.goo.gl/abc123')).toEqual({})
    expect(parseMapsUrl('https://example.com')).toBeNull()
  })
})

describe('place lines', () => {
  it('reads a place link on its own line', () => {
    expect(parsePlaceLine(placeMarkdown(tower))).toEqual({
      name: 'Eiffel Tower',
      url: mapsUrl(tower),
      address: tower.address,
      target: { lat: tower.lat, lon: tower.lon }
    })
  })

  it('reads a pasted Google Maps link', () => {
    expect(parsePlaceLine('https://maps.google.com/?q=Tower+of+London')).toMatchObject({ name: 'Tower of London', address: '' })
    expect(parsePlaceLine('https://maps.app.goo.gl/abc123')).toMatchObject({ name: 'Place on Google Maps' })
  })

  it('leaves other lines alone', () => {
    expect(parsePlaceLine('Meet at [the tower](https://maps.google.com/?q=Eiffel) at 6')).toBeNull()
    expect(parsePlaceLine('[a site](https://example.com)')).toBeNull()
    expect(parsePlaceLine('just words')).toBeNull()
  })
})

describe('search results', () => {
  it('splits the name from the rest of the address', () => {
    const places = placesFromSearch([
      { lat: '48.8582602', lon: '2.2944991', name: 'Eiffel Tower', display_name: 'Eiffel Tower, Avenue Gustave Eiffel, Paris, France' },
      { lat: '51.5', lon: '-0.1', name: '', display_name: '12, High Street, London, UK' },
      { lat: 'x', lon: '1', display_name: 'Broken' }
    ])
    expect(places).toEqual([
      tower,
      { name: '12 High Street', address: 'London, UK', lat: 51.5, lon: -0.1 }
    ])
    expect(placesFromSearch({ error: 'nope' })).toEqual([])
  })
})

describe('map squares', () => {
  it('finds the square a point is in', () => {
    // The top-left corner of the world map.
    expect(tileAt(85.05112878, -180, 1)).toEqual({ x: 0, y: 0, px: 0, py: 0 })
    // (0, 0) is the corner where the four squares meet at zoom 1.
    expect(tileAt(0, 0, 1)).toEqual({ x: 1, y: 1, px: 0, py: 0 })
    const t = tileAt(tower.lat, tower.lon, 15)
    expect(t.x).toBe(16592)
    expect(t.y).toBe(11272)
    expect(t.px).toBeGreaterThanOrEqual(0)
    expect(t.px).toBeLessThan(256)
  })
})
