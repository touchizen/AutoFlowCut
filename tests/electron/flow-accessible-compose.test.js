// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { assetRow, editorNode, generationNode, matchesAccessiblePlan } from '../../electron/flow-accessible-compose.js'

const node = (role, { name = '', value = '', selected, children = [] } = {}) => ({
  role,
  name,
  value,
  ...(selected === undefined ? {} : { selected }),
  children,
})

const plan = [
  { t: 'text', text: 'Blue glaze ' },
  { t: 'mention', ref: 0 },
]
const labels = ['CupPalette.jpg']

function composer({ editorValue = 'Blue glaze CupPalette.jpg', duplicateGenerate = false } = {}) {
  const editor = node('TextField', {
    name: 'Prompt',
    value: editorValue,
    children: [
      node('StaticText', { name: 'Blue glaze ' }),
      node('StaticText', { name: 'CupPalette.jpg' }),
    ],
  })
  const generate = node('Button', { name: 'Generate', selected: false })
  return node('WebArea', { children: [
    node('Group', { name: 'Image composer', children: [editor, generate] }),
    ...(duplicateGenerate ? [node('Button', { name: 'Generate', selected: false })] : []),
  ] })
}

describe('accessible Flow composer snapshot matching', () => {
  it('finds the editor and unique generation button by accessible roles and names', () => {
    const root = composer()

    expect(editorNode(root)).toBe(root.children[0].children[0])
    expect(generationNode(root)).toBe(root.children[0].children[1])
  })

  it('matches text and a mention split across StaticText leaves only when editor value is the full text', () => {
    const root = composer()

    expect(matchesAccessiblePlan(root, plan, labels)).toBe(true)
    expect(matchesAccessiblePlan(composer({ editorValue: 'Blue glaze ' }), plan, labels)).toBe(false)
  })

  it('throws instead of choosing when generation buttons are duplicated', () => {
    expect(() => generationNode(composer({ duplicateGenerate: true }))).toThrow()
  })
})

it('selects the real Mac picker value, including its selection announcement, and refuses duplicate filenames', () => {
  const actual=node('MenuItem', {value:'CupPalette-9132a3bac013.jpg 이미지 선택되지 않음'})
  const similar=node('MenuItem', {value:'Copy CupPalette-9132a3bac013.jpg 이미지 선택됨'})
  const list=node('List',{children:[similar,actual]})
  expect(assetRow(list,'CupPalette-9132a3bac013.jpg')).toBe(actual)
  list.children.push({...actual})
  expect(()=>assetRow(list,'CupPalette-9132a3bac013.jpg')).toThrow('reference-asset-not-unique')
})
