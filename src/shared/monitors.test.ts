import { describe, expect, it } from 'vitest'
import { cleanSaved, defaultHotkeys, inputChoices, inputFromReply, inputName, nextLevel, parseCapabilities, parseM1ddcList, percent, VCP } from './monitors'

const DELL = '(prot(monitor)type(LCD)model(U2720Q)cmds(01 02 03 07 0C E3 F3)vcp(02 04 05 08 10 12 14(05 08 0B 0C) 16 18 1A 52 60(0F 11 12 1B) AA(01 02) AC AE B2 B6 C6 C8 C9 D6(01 04 05) DC(00 03 05) DF E0 E1 E2(00 1D 02 04) F0(00 08) F1 F2 FD)mswhql(1)asset_eep(40)mccs_ver(2.1))'

describe('parseCapabilities', () => {
  it('reads the model and the inputs a monitor lists', () => {
    const caps = parseCapabilities(DELL)
    expect(caps.model).toBe('U2720Q')
    expect(caps.vcp.get(VCP.input)).toEqual([0x0f, 0x11, 0x12, 0x1b])
    expect(caps.vcp.has(VCP.brightness)).toBe(true)
    expect(caps.vcp.get(0x14)).toEqual([0x05, 0x08, 0x0b, 0x0c])
  })

  it('copes with codes run together and nothing to read', () => {
    expect([...parseCapabilities('vcp(101260(1112))').vcp.keys()]).toEqual([0x10, 0x12, 0x60])
    expect(parseCapabilities('vcp(101260(1112))').vcp.get(0x60)).toEqual([0x11, 0x12])
    expect(parseCapabilities('').vcp.size).toBe(0)
  })
})

describe('inputs', () => {
  it('names the standard inputs and unknown ones', () => {
    expect(inputName(0x11)).toBe('HDMI 1')
    expect(inputName(0x0f)).toBe('DisplayPort 1')
    expect(inputName(0x90)).toBe('Input 90')
  })

  it('ignores the high byte some monitors send', () => {
    expect(inputFromReply(0x010f)).toBe(0x0f)
  })

  it('offers the listed inputs, your names, and the one showing now', () => {
    const caps = parseCapabilities(DELL)
    expect(inputChoices(caps, 0x11, { '17': 'PC' }).map((i) => i.label)).toEqual(['DisplayPort 1', 'PC', 'HDMI 2', 'USB-C'])
    expect(inputChoices(null, 0x90).map((i) => i.value)).toEqual([0x0f, 0x10, 0x11, 0x12, 0x1b, 0x90])
  })
})

describe('levels', () => {
  it('steps in percent of the screen’s range and stays inside it', () => {
    expect(nextLevel({ value: 50, max: 100 }, 'up', 10)).toBe(60)
    expect(nextLevel({ value: 5, max: 100 }, 'down', 10)).toBe(0)
    expect(nextLevel({ value: 95, max: 100 }, 'up', 10)).toBe(100)
    expect(nextLevel({ value: 0, max: 50 }, 'set', 40)).toBe(20)
    expect(percent({ value: 25, max: 50 })).toBe(50)
  })
})

describe('parseM1ddcList', () => {
  it('reads the displays m1ddc lists', () => {
    const out = '[1] DELL U2720Q (37D8832A-2D66-02CA-B9F7-8F30A301B230)\n[2] LG HDR 4K (1A2B3C4D-0000-1111-2222-333344445555)\n'
    expect(parseM1ddcList(out)).toEqual([
      { index: 1, name: 'DELL U2720Q', uuid: '37D8832A-2D66-02CA-B9F7-8F30A301B230' },
      { index: 2, name: 'LG HDR 4K', uuid: '1A2B3C4D-0000-1111-2222-333344445555' }
    ])
  })
})

describe('cleanSaved', () => {
  it('keeps good hotkeys and drops broken ones', () => {
    const saved = cleanSaved({
      names: { 'DISPLAY1:0': '  Left  ', bad: 4 },
      inputNames: { 'DISPLAY1:0': { '17': 'PC', x: 'no' } },
      hotkeys: [
        ...defaultHotkeys(),
        { id: 'mac', keys: 'Control+Alt+M', monitor: 'DISPLAY1:0', action: { kind: 'input', value: 0x1b } },
        { id: 'mac', keys: 'F1', monitor: 'all', action: { kind: 'input', value: 3 } },
        { id: 'bad', keys: 'F2', monitor: 'all', action: { kind: 'volume' } },
        { id: 'big', keys: 'F3', action: { kind: 'contrast', mode: 'set', amount: 500 } }
      ]
    })
    expect(saved.names).toEqual({ 'DISPLAY1:0': 'Left' })
    expect(saved.inputNames).toEqual({ 'DISPLAY1:0': { '17': 'PC' } })
    expect(saved.hotkeys.map((h) => h.id)).toEqual(['bright-up', 'bright-down', 'mac', 'big'])
    expect(saved.hotkeys[3]).toEqual({ id: 'big', keys: 'F3', monitor: 'all', action: { kind: 'contrast', mode: 'set', amount: 100 } })
    expect(cleanSaved(null)).toEqual({ names: {}, inputNames: {}, hotkeys: [] })
  })
})
