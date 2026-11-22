"""Split the approved SVG into scene layers without redrawing the artwork.
Run from repository root. Cropping metadata is supplied by the browser SVG bounds pass.
"""
import copy
import json
from pathlib import Path
import xml.etree.ElementTree as ET

ET.register_namespace('', 'http://www.w3.org/2000/svg')
source = ET.parse('public/assets/office/room.svg').getroot()
groups = source[1]
output = Path('public/assets/office/layers')
output.mkdir(exist_ok=True)
assert len(groups) == 10, 'Source SVG structure changed: update layer extraction and crop bounds.'
assert groups[7].get('id') == 'four-person-meeting-area'
assert all(groups[n].get('data-pose') == 'seated' for n in [5, 6, 8, 9])

def save(name, index, children=None):
    group = copy.deepcopy(groups[index])
    if children is not None:
        for n, child in reversed(list(enumerate(group))):
            if n not in children:
                group.remove(child)
    bounds_path = output / 'bounds.json'
    bounds = json.loads(bounds_path.read_text()).get(name) if bounds_path.exists() else None
    attrs = {'viewBox': '60 90 1300 660', 'width': '1300', 'height': '660'}
    if bounds:
        attrs = {'viewBox': f"{bounds['x']} {bounds['y']} {bounds['width']} {bounds['height']}", 'width': str(bounds['width']), 'height': str(bounds['height'])}
    svg = ET.Element(source.tag, attrs)
    svg.append(group)
    ET.ElementTree(svg).write(output / f'{name}.svg', encoding='unicode')

for name, index in [('shell',0),('designer-desk',1),('pm-desk',3),('planner-desk',4)]:
    save(name,index)
laptop_index = next(i for i, child in enumerate(groups[2]) if child.get('id') == 'developer-laptop')
save('developer-desk', 2, [i for i in range(len(groups[2])) if i != laptop_index])
save('developer-laptop', 2, [laptop_index])
for name,index,end in [('pm',8,23),('planner',9,21)]:
    save(name,index,range(2,end))
    save(f'{name}-chair',index,[1,*range(end,len(groups[index]))])
for name,index in [('designer',5),('developer',6)]:
    save(name,index,range(11,20))
    save(f'{name}-chair',index,range(1,11))
    save(f'{name}-armrest',index,[20,21])
save('meeting-table',7,range(3,12))
save('meeting-chairs-back',7,[1,2])
save('meeting-chairs-front',7,[12,13])
print(json.dumps([p.stem for p in output.glob('*.svg')]))

bounds_path = output / 'bounds.json'
if bounds_path.exists():
    manifest = json.loads(bounds_path.read_text())
    Path('src/components/office/scene/assets.ts').write_text(
        '// Generated crop bounds for the approved SVG layers. See scripts/split-office-assets.py.\n'
        + 'export const officeAssetBounds = ' + json.dumps(manifest, indent=2)
        + ' as const;\n'
    )
