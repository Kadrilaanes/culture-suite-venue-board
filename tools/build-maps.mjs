// Regenerates src/data/maps.json: Natural Earth boundaries projected to Mercator
// and emitted as SVG path data, so the page needs no map tiles at runtime.
import fs from 'fs';
import path from 'path';
const ROOT = path.resolve(import.meta.dirname, '..');
import { feature } from 'topojson-client';
import { geoMercator, geoPath, geoBounds } from 'd3-geo';

const t50 = JSON.parse(fs.readFileSync(path.join(ROOT,'node_modules/world-atlas/countries-50m.json'),'utf8'));
const t110 = JSON.parse(fs.readFileSync(path.join(ROOT,'node_modules/world-atlas/countries-110m.json'),'utf8'));
const w50 = feature(t50, t50.objects.countries);
const w110 = feature(t110, t110.objects.countries);

const ISO = {
  'United Kingdom':'UK','Ireland':'IE','Netherlands':'NL','Belgium':'BE',
  'Germany':'DE','Norway':'NO','United States of America':'US','France':'FR',
  'Luxembourg':'LU','Denmark':'DK','Sweden':'SE','Switzerland':'CH','Austria':'AT',
  'Canada':'CA','Mexico':'MX','Czechia':'CZ','Poland':'PL',
  'Finland':'FI','Iceland':'IS','Estonia':'EE','Latvia':'LV','Lithuania':'LT',
  'Russia':'RU','Belarus':'BY','Slovakia':'SK','Hungary':'HU'
};

const DEFS = {
  europe: { src:w50,  bbox:[-24.5, 48, 31, 66.5], w: 940 },
  na:     { src:w110, bbox:[-162, 17.5, -64, 52.5], w: 880 }
};

function build(def){
  const [w0,s0,e0,n0] = def.bbox;
  const R = d => d*Math.PI/180;
  const my = lat => Math.log(Math.tan(Math.PI/4 + R(lat)/2));
  const x0 = R(w0), x1 = R(e0);
  const y1 = my(n0), y0 = my(s0);
  const k = def.w / (x1 - x0);
  const h = Math.round((y1 - y0) * k);

  const proj = geoMercator().scale(k).translate([-x0*k, y1*k]).center([0,0]);
  const path = geoPath(proj);

  const feats = [];
  for (const f of def.src.features){
    const nm = f.properties.name;
    const [[bw,bs],[be,bn]] = geoBounds(f);
    if (be < w0 || bw > e0 || bn < s0 || bs > n0) continue;
    let d = path(f);
    if (!d) continue;
    d = d.replace(/\.\d+/g,'');
    if (d.length < 60) continue;
    feats.push({ n: ISO[nm] || '', d });
  }
  return { w: def.w, h, k, x0, y1, feats };
}

const out = {};
for (const [n,d] of Object.entries(DEFS)) out[n] = build(d);
for (const [n,m] of Object.entries(out))
  console.log(n, m.w+'x'+m.h, 'countries', m.feats.length, 'kb', Math.round(JSON.stringify(m).length/1024));
fs.writeFileSync(path.join(ROOT,'src/data/maps.json'), JSON.stringify(out));
