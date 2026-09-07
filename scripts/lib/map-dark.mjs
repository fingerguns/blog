/**
 * Dark-basemap contrast.
 *
 * OpenFreeMap's `dark` style is close to unreadable on this site: land is
 * rgb(12,12,12) and water rgb(27,27,29), a WCAG contrast ratio of 1.14 — the
 * coastline is essentially invisible — with place labels at rgb(101,101,101)
 * for 3.36 against land.
 *
 * The obvious fix, a CSS `filter` on the canvas, does not work for the thing
 * that matters most. `brightness()` multiplies, so it cannot create separation
 * that is not there: at 1.6 it lifts labels nicely (3.36 → 7.23) but moves
 * land/water only 1.14 → 1.32. Adding `contrast()` makes it actively worse
 * (1.17), because it pushes two near-blacks toward each other. Swapping to
 * OpenFreeMap's `fiord` reaches only 1.25 and turns the map slate blue.
 *
 * So the colours are patched directly on the loaded style instead, which is the
 * only approach that can move land and water independently:
 *
 *   land/water 1.14 → 1.71   label/land 3.36 → 11.03
 *   road/land  1.30 → 2.46   boundary/land ~1.3 → 5.16
 *
 * Land stays within 1.07 of the page background (--bg #16130f) so the map reads
 * as part of the page rather than as a lit rectangle sitting on it.
 */

export const DARK_MAP_PALETTE = {
  land: "#1e1a15",
  water: "#2b4360",
  label: "#d3cec3",
  halo: "#0b0a08",
  road: "#5e584f",
  boundary: "#948b7f",
  // Area fills. These are not cosmetic extras: the style paints buildings at
  // rgb(10,10,10) and airports at #000, which vanished against the old
  // rgb(12,12,12) land but would read as black holes once land is lifted. They
  // only appear at city zoom — where the admin Location maps live.
  building: "#282218",
  landuse: "#221e18",
  park: "#1f2a1c",
};

/**
 * Client-side source for `recolorDarkBasemap(map)`, inlined into every page
 * that draws a map. Call it on `styledata` — a style swap (the theme toggle)
 * replaces every layer, so the patch has to be re-applied each time.
 *
 * It only touches layers from the basemap's own `openmaptiles` source, plus the
 * sourceless `background` layer. That guard matters: without it the `/now/`
 * neighborhood outline, the admin track line and the heatmap dots are all line
 * or fill layers that would be repainted as roads.
 *
 * admin/index.html carries a hand-inlined copy of this, since it is a static
 * page the build copies verbatim and cannot import from here.
 * `map-dark.test.mjs` asserts the two palettes stay identical.
 */
export const DARK_MAP_RECOLOR_JS = `function recolorDarkBasemap(map){
  if(!map)return;
  var P=${JSON.stringify(DARK_MAP_PALETTE)};
  var layers;
  try{layers=(map.getStyle()||{}).layers||[];}catch(e){return;}
  layers.forEach(function(l){
    // Only the basemap's own layers: ours are drawn from other sources and
    // repainting them would turn a neighborhood outline into a road.
    if(l.id!=='background'&&l.source!=='openmaptiles')return;
    try{
      if(l.id==='background')map.setPaintProperty(l.id,'background-color',P.land);
      else if(/water/.test(l.id)&&l.type!=='symbol')map.setPaintProperty(l.id,l.type==='fill'?'fill-color':'line-color',P.water);
      else if(l.type==='symbol'){
        map.setPaintProperty(l.id,'text-color',P.label);
        map.setPaintProperty(l.id,'text-halo-color',P.halo);
      }
      else if(l.type==='line')map.setPaintProperty(l.id,'line-color',/boundary|admin/.test(l.id)?P.boundary:P.road);
      else if(l.type==='fill'){
        var fill=P.land;
        if(l.id==='building')fill=P.building;
        else if(/wood|forest|park|grass|scrub/.test(l.id))fill=P.park;
        else if(/landuse/.test(l.id))fill=P.landuse;
        map.setPaintProperty(l.id,'fill-color',fill);
      }
    }catch(e){/* a layer that has no such paint property; leave it as it is */}
  });
}`;
