"""#858 AC4, a MEASURING branch: never merged. Applies one named mutant to the
tree, asserting its anchor matched once and the new text is present, then
prints the change. `none` is the control: the guard must stay GREEN."""
import pathlib, sys

J = 'tests/device/ios/journeys.journey.ts'
ANCHOR = "        logMode(`Journey 14 (${locale}, ${shape.count}/${shape.size})`);\n"

def insert_after(path, anchor, line):
    p = pathlib.Path(path); t = p.read_text()
    assert t.count(anchor) == 1, (path, t.count(anchor))
    p.write_text(t.replace(anchor, anchor + line))
    assert line in p.read_text()

def replace(path, old, new):
    p = pathlib.Path(path); t = p.read_text()
    assert t.count(old) == 1, (path, old, t.count(old))
    p.write_text(t.replace(old, new))
    t = p.read_text(); assert new in t and old not in t

def create(path, text):
    p = pathlib.Path(path); assert not p.exists(), path
    p.write_text(text)

M = {
  'none': lambda: None,
  'journey-expect': lambda: insert_after(J, ANCHOR, '        expect(1).toBe(1);\n'),
  'new-journey-test': lambda: create('tests/device/ios/x.journey.ts', "import { test } from 'vitest';\n\ntest('x', () => {});\n"),
  'expect-in-comment': lambda: insert_after(J, ANCHOR, '        // expect(1).toBe(1);\n'),
  'expect-in-string': lambda: insert_after(J, ANCHOR, "        logMode('expect(');\n"),
  'hand-raised-ceiling': lambda: replace('tests/ios-ceilings.json', '"assertions": 59', '"assertions": 60'),
  'empty-walk': lambda: replace('tests/ios-ceilings.ts', 'new Map(iosFiles().map(', 'new Map(iosFiles().slice(0, 0).map('),
  'parse-blind': lambda: replace('tests/ios-ceilings.ts', '  visit(parse(source));\n  return { tests, assertions };', '  visit(parse(source));\n  return { tests: 0, assertions: 0 };'),
}

def aliased():
    p = pathlib.Path('tests/device/ios/evidence.ts'); t = p.read_text()
    line = "import { expect as check } from 'vitest';\n"
    assert line not in t
    p.write_text(line + t); assert p.read_text().startswith(line)
M['aliased-import'] = aliased

name = sys.argv[1]
M[name]()
print(f'mutant {name} applied')
