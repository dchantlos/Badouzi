export function waterContactBounds(positions, faces, waterHeight, scale) {
  if (positions.length % 3 || faces.length % 3 || !Number.isFinite(waterHeight) ||
    !Number.isFinite(scale) || scale <= 0) throw new RangeError("Invalid water-contact geometry");
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  function include(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Non-finite water-contact vertex");
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let face = 0; face < faces.length; face += 3) {
    let previous = faces[face + 2] * 3;
    for (let corner = 0; corner < 3; corner++) {
      const current = faces[face + corner] * 3;
      if (current < 0 || current + 2 >= positions.length || previous < 0 || previous + 2 >= positions.length) {
        throw new RangeError("Water-contact face references a missing vertex");
      }
      const a = positions[previous + 2] - waterHeight;
      const b = positions[current + 2] - waterHeight;
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("Non-finite water-contact height");
      if (b === 0) include(positions[current], positions[current + 1]);
      if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
        const t = a / (a - b);
        include(positions[previous] + (positions[current] - positions[previous]) * t,
          positions[previous + 1] + (positions[current + 1] - positions[previous + 1]) * t);
      }
      previous = current;
    }
  }
  if (minX === Infinity || maxX - minX < 0.001 || maxY - minY < 0.001) return null;
  return { minX: minX * scale, maxX: maxX * scale, minY: minY * scale, maxY: maxY * scale };
}
