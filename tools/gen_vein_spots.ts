// One-off generator of the fixed new-vein spots (S4, D33): `node --import tsx tools/gen_vein_spots.ts`.
// Rejection sampling with a fixed seed inside hand-chosen regions; it rewrites src/game/veinSpots.ts, which is
// then committed as data (the game never samples at runtime). Every spot passes tools/vein_spot_rules.ts.
import { writeFileSync } from 'node:fs';
import { heightAt, random, coreBlend, canyonDist, MESA, CRATER } from '../src/world';
import type { VeinMaterial } from '../src/game/resources';
import { spotProblem, SPOT_GAP } from './vein_spot_rules';
type Region = { name: string; count: number; far: boolean; box: [number, number, number, number]; ok: (x: number, z: number) => boolean };
const valley = (x: number, z: number) => x >= 0 && x <= 160 && z >= 0 && z <= 160;
const PLAN: Record<VeinMaterial, Region[]> = {
 // Iron: the hillside east of the valley and the cave, then the canyon floor and the wild hills.
 iron: [{ name: 'восток долины', count: 7, far: false, box: [84, 160, 6, 120], ok: valley },
  { name: 'дно русла', count: 2, far: true, box: [-140, 300, -140, -40], ok: (x, z) => Math.abs(canyonDist(x, z)) < 5 },
  { name: 'дикие холмы', count: 2, far: true, box: [-140, 300, -140, 300], ok: (x, z) => coreBlend(x, z) > .3 && !valley(x, z) }],
 // Copper: around the split spire and the copper outcrops, then the mesa foot.
 copper: [{ name: 'скалы и медь', count: 7, far: false, box: [70, 130, 30, 125], ok: valley },
  { name: 'подножие плато', count: 3, far: true, box: [MESA.x - 60, MESA.x + 60, MESA.z - 60, MESA.z + 60], ok: (x, z) => { const d = Math.hypot(x - MESA.x, z - MESA.z); return d > MESA.r + 4 && d < MESA.r + 18; } }],
 stone: [{ name: 'долина', count: 7, far: false, box: [2, 158, 2, 158], ok: valley },
  { name: 'дикие холмы', count: 3, far: true, box: [-140, 300, -140, 300], ok: (x, z) => coreBlend(x, z) > .3 && !valley(x, z) }],
 // Sand: low ground of the valley, then the canyon floor.
 sand: [{ name: 'низины долины', count: 7, far: false, box: [2, 158, 2, 158], ok: (x, z) => valley(x, z) && heightAt(x, z) < .2 },
  { name: 'дно русла', count: 3, far: true, box: [-140, 300, -140, -40], ok: (x, z) => Math.abs(canyonDist(x, z)) < 5 }],
 // Ice: the frozen hollow and other cold lows of the valley, then the crater floor.
 ice: [{ name: 'ледяная низина', count: 7, far: false, box: [2, 80, 50, 120], ok: (x, z) => valley(x, z) && (Math.hypot(x - 30, z - 80) < 26 || heightAt(x, z) < -.4) },
  { name: 'дно кратера', count: 3, far: true, box: [CRATER.x - 30, CRATER.x + 30, CRATER.z - 30, CRATER.z + 30], ok: (x, z) => Math.hypot(x - CRATER.x, z - CRATER.z) < CRATER.r - 14 }],
};
const spots: { id: string; material: VeinMaterial; x: number; z: number; far: boolean }[] = [];
const rng = random(33033);
for (const m of Object.keys(PLAN) as VeinMaterial[]) {
 let n = 0;
 for (const r of PLAN[m]) {
  let got = 0, tries = 0;
  while (got < r.count && tries++ < 20000) {
   const x = Math.round((r.box[0] + rng() * (r.box[1] - r.box[0])) * 10) / 10, z = Math.round((r.box[2] + rng() * (r.box[3] - r.box[2])) * 10) / 10;
   if (!r.ok(x, z) || spotProblem(x, z, m) || spots.some(s => Math.hypot(s.x - x, s.z - z) < SPOT_GAP)) continue;
   spots.push({ id: `${m}-s${++n}`, material: m, x, z, far: r.far }); got++;
  }
  console.log(m, r.name, got, '/', r.count, 'tries', tries);
 }
}
const line = (s: typeof spots[number]) => ` { id: '${s.id}', material: '${s.material}', x: ${s.x}, z: ${s.z}${s.far ? ', far: true' : ''} },`;
writeFileSync(new URL('../src/game/veinSpots.ts', import.meta.url), `import type { VeinSpot } from './resources';
/**
 * Fixed places where a new vein can appear (S4, D33). Generated once by tools/gen_vein_spots.ts (seeded rejection
 * sampling under tools/vein_spot_rules.ts) and committed as data; tests/veins.test.ts re-checks every spot. About two
 * thirds lie in the arrival valley; \`far\` spots are on the canyon floor, the mesa foot, the wild hills and the crater floor.
 */
export const VEIN_SPOTS: VeinSpot[] = [
${spots.map(line).join('\n')}
];
`);
console.log('spots', spots.length);
