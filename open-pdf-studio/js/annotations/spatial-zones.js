// Data-only location rules. Coordinates are unrotated page coordinates in points.
export function zoneDefinition(value) {
  if (!value || value.version !== 1 || typeof value.id !== 'string' || !value.id || value.id.length > 100 ||
      typeof value.name !== 'string' || !value.name.trim() || value.name.length > 200) return null;
  return { version: 1, id: value.id, name: value.name.trim(),
    parentId: typeof value.parentId === 'string' ? value.parentId.slice(0, 100) : '' };
}
export function zonePolygon(ann) {
  if (['polygon', 'measureArea', 'filledArea'].includes(ann?.type) && Array.isArray(ann.points) &&
      !ann.arcFlags?.some(Boolean) && !ann.holes?.length) {
    return ann.points.length >= 3 && ann.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)) ? ann.points : null;
  }
  if (ann?.type !== 'box' || ann.rotation) return null;
  const {x,y,width:w,height:h}=ann;
  if (![x,y,w,h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
}
function area(points) {
  return Math.abs(points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-q.x*p.y;},0))/2;
}
export function containsPoint(points, p) {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[j],b=points[i];
    const cross=(p.x-a.x)*(b.y-a.y)-(p.y-a.y)*(b.x-a.x);
    if(Math.abs(cross)<1e-7 && p.x>=Math.min(a.x,b.x)-1e-7 && p.x<=Math.max(a.x,b.x)+1e-7 &&
       p.y>=Math.min(a.y,b.y)-1e-7 && p.y<=Math.max(a.y,b.y)+1e-7) return true;
    if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
export function collectZones(annotations) {
  const candidates=(annotations||[]).map(ann=>({ann, zone:zoneDefinition(ann.spatialZone), polygon:zonePolygon(ann)}))
    .filter(z=>z.zone && z.polygon && area(z.polygon)>0);
  const byId=new Map();
  const duplicates=new Set();
  for(const z of candidates){if(byId.has(z.zone.id))duplicates.add(z.zone.id);byId.set(z.zone.id,z);}
  return candidates.map(z=>{
    const chain=[];const seen=new Set();let cur=z;
    while(cur){
      if(seen.has(cur.zone.id)||duplicates.has(cur.zone.id))return {...z,valid:false,path:'',depth:0};
      seen.add(cur.zone.id);chain.unshift(cur.zone.name);
      if(cur.zone.parentId&&!byId.has(cur.zone.parentId))return {...z,valid:false,path:'',depth:0};
      cur=byId.get(cur.zone.parentId);
    }
    return {...z,valid:true,path:chain.join(' / '),depth:chain.length,area:area(z.polygon)};
  });
}
export function locationFor(ann, zones, bounds) {
  if (typeof ann.locationOverride === 'string') return {path:ann.locationOverride,source:'manual',zoneId:null};
  if(!bounds) return {path:'',source:'none',zoneId:null};
  const center={x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2};
  const hits=zones.filter(z=>z.valid && (z.ann!==ann && (!ann.id || z.ann.id!==ann.id)) && z.ann.page===ann.page && containsPoint(z.polygon,center))
    .sort((a,b)=>b.depth-a.depth || a.area-b.area || (a.zone.id<b.zone.id?-1:a.zone.id>b.zone.id?1:0));
  const hit=hits[0];
  return {path:hit?.path||'',source:hit?'computed':'none',zoneId:hit?.zone.id||null};
}

// A pasted subtree has its own identities; parents outside the selection detach.
export function relinkCopiedZones(sources, copies) {
  const ids=new Map();
  for(let i=0;i<sources.length;i++){
    const z=zoneDefinition(sources[i].spatialZone);
    if(z && copies[i]) ids.set(z.id,'zone_'+copies[i].id);
  }
  for(let i=0;i<sources.length;i++){
    const z=zoneDefinition(sources[i].spatialZone);
    if(z && copies[i]) copies[i].spatialZone={...z,id:ids.get(z.id),parentId:ids.get(z.parentId)||''};
  }
  return copies;
}
