export const DORSAL_REGIONS = ["tail", "back", "crown"];
export const DORSAL_MAX_STRENGTH = 7.5;
const DORSAL_COLOR = [64, 200, 255];

export function dorsalEmission(progress) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError("Dorsal emission progress must be between zero and one");
  }
  return {
    color: progress === 0 ? [0, 0, 0] : DORSAL_COLOR,
    strength: progress * DORSAL_MAX_STRENGTH
  };
}

export function partitionDorsalPlates(positions, faces) {
  if (!positions || positions.length % 3 || !faces || faces.length % 3) {
    throw new TypeError("Dorsal selection requires indexed triangle geometry");
  }
  const vertexCount = positions.length / 3;
  const parents = Int32Array.from({ length: vertexCount }, (_, index) => index);
  function root(index) {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  }
  for (let index = 0; index < faces.length; index += 3) {
    const triangle = [faces[index], faces[index + 1], faces[index + 2]];
    if (!triangle.every(vertex => Number.isInteger(vertex) && vertex >= 0 && vertex < vertexCount)) {
      throw new RangeError("Dorsal selection contains an invalid vertex index");
    }
    parents[root(triangle[0])] = root(triangle[1]);
    parents[root(triangle[0])] = root(triangle[2]);
  }
  const islands = new Map();
  for (let index = 0; index < faces.length; index += 3) {
    const key = root(faces[index]);
    let island = islands.get(key);
    if (!island) {
      island = { faces: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      islands.set(key, island);
    }
    for (let corner = 0; corner < 3; corner++) {
      const vertex = faces[index + corner];
      island.faces.push(vertex);
      for (let axis = 0; axis < 3; axis++) {
        const value = positions[vertex * 3 + axis];
        if (!Number.isFinite(value)) throw new TypeError("Dorsal selection has a non-finite position");
        island.min[axis] = Math.min(island.min[axis], value);
        island.max[axis] = Math.max(island.max[axis], value);
      }
    }
  }
  const groups = { body: [], tail: [], back: [], crown: [] };
  let selectedIslands = 0;
  for (const island of islands.values()) {
    // The supplied model's UV seams separate its plates. Bounds are in its
    // unscaled east/north/up bind frame; do not weld these seams together.
    const dorsal =
      Math.max(Math.abs(island.min[0]), Math.abs(island.max[0])) < 10 &&
      island.min[2] > 12 &&
      island.max[2] - island.min[2] < 20 &&
      island.min[1] > -24;
    const region = dorsal
      ? island.min[1] > 18 ? "tail" : island.min[1] > 0 ? "back" : "crown"
      : "body";
    if (dorsal) selectedIslands++;
    for (const index of island.faces) groups[region].push(index);
  }
  if (!groups.body.length || DORSAL_REGIONS.some(region => !groups[region].length)) {
    throw new Error("The model's dorsal-plate regions could not be isolated safely");
  }
  return {
    groups: Object.fromEntries(Object.entries(groups).map(([region, indices]) => [region, new Uint32Array(indices)])),
    selectedIslands
  };
}
