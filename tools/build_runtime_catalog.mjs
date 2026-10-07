/** Derived runtime subset: numbers/names always come from the normative design catalog. */
import {readFile,writeFile} from 'node:fs/promises';
const catalog=JSON.parse(await readFile(new URL('../docs/data/catalog.json',import.meta.url),'utf8'));
const items=['wrench','grass','fiber','sand','iron','copper','glass','wire','circuit','workbench','kiln','biogenerator','electrolyzer','refill','distributor','dome','cable','gas_pipe'];
const recipes=['craft_wrench','grass_parts','craft_workbench','craft_kiln','craft_tool_stone','smelt_iron_raw','smelt_copper_raw','glass','craft_wire','craft_circuit','craft_biogenerator','craft_electrolyzer','craft_refill','craft_bottle_1','craft_distributor','craft_dome','craft_cable','craft_gas_pipe','melt_in_generator','electrolysis'];
for(const id of items)if(!catalog.items[id])throw new Error('Missing design item: '+id);
const selected=catalog.recipes.filter(r=>recipes.includes(r.id));if(selected.length!==recipes.length)throw new Error('Missing or duplicate design recipe');
await writeFile(new URL('../src/game/catalog.generated.json',import.meta.url),JSON.stringify({version:catalog.version,upgrades:catalog.upgrades,items:Object.fromEntries(items.map(id=>[id,catalog.items[id]])),recipes:selected},null,2)+'\n');
