import vertex from './vertex.js';
import containment from './containment.js';
import obsidian from './obsidian.js';

function normalize(map) {
  for (const n of map.nav || []) n.y ??= 0;
  return map;
}

export const MAPS = {
  vertex: normalize(vertex),
  containment: normalize(containment),
  obsidian: normalize(obsidian),
};
