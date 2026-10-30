/* ============================================================
   Badouzi Port Digital Twin — what-if exposure arithmetic
   Pure functions (no ArcGIS SDK, no DOM) so the scenario maths can be
   unit-tested with `npm test`.
   ============================================================ */

/**
 * Waterline rule shared by the markers, totals, land-sample estimate and the
 * location check: ground AT or below the modelled water surface is exposed.
 */
export function isAtOrBelowWater(groundZ, waterZ) {
  return groundZ <= waterZ;
}

export function isValidElevation(z) {
  return typeof z === "number" && Number.isFinite(z);
}

export function isValidUnitValue(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

const USD_NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Explicit "US$" formatting — a bare "$" is ambiguous for a Taiwan audience. */
export function formatUSD(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "\u2014";
  return "US$" + USD_NUMBER.format(amount);
}

/**
 * Evaluate one water level against the loaded asset inventory.
 *
 * @param {Array} inputs  One entry per expected analysis input:
 *   { id, label, singular?, status: "ok" | "failed" | "missing", reason?, items? }
 *   Each item: { category, groundZ, issue? } — an item without a valid
 *   groundZ could not be assessed (its `issue` explains why).
 * @param {number} waterZ  Water-surface height of the scenario.
 * @param {Object} unitValues  Assumed replacement value per item category.
 *
 * The result is "complete" only when every input loaded, every item has a
 * valid ground elevation and every exposed item has a valid unit value.
 * Missing data is never counted as zero exposure or zero value.
 */
export function evaluateScenario(inputs, waterZ, unitValues) {
  const noun = (input, count) => (count === 1 && input.singular ? input.singular : input.label);
  const exposed = [];
  const perInput = [];
  const problems = [];
  const unvalued = new Map(); // input label -> exposed items without a unit value
  let assessedInputs = 0;
  let exposedCount = 0;
  let subtotal = 0;
  let countComplete = inputs.length > 0;

  for (const input of inputs) {
    if (input.status !== "ok") {
      countComplete = false;
      problems.push(input.reason || input.label + " unavailable");
      perInput.push({ id: input.id, label: input.label, singular: input.singular, status: input.status, exposed: null, notAssessed: null });
      continue;
    }

    let n = 0;
    const issues = new Map(); // reason -> count of items not assessed
    for (const item of input.items) {
      if (!isValidElevation(item.groundZ)) {
        const why = item.issue || "no valid ground elevation";
        issues.set(why, (issues.get(why) || 0) + 1);
        continue;
      }
      if (!isAtOrBelowWater(item.groundZ, waterZ)) continue;

      n++;
      const unit = unitValues ? unitValues[item.category] : undefined;
      const valued = isValidUnitValue(unit);
      if (valued) subtotal += unit;
      else unvalued.set(input, (unvalued.get(input) || 0) + 1);
      exposed.push({ item, depth: waterZ - item.groundZ, unitValue: valued ? unit : null });
    }

    let notAssessed = 0;
    issues.forEach(function (count, why) {
      notAssessed += count;
    });
    if (notAssessed > 0) countComplete = false;

    // Every record lacked a usable elevation: nothing from this input was
    // assessed, so it is unavailable — not "0 exposed".
    if (input.items.length > 0 && notAssessed === input.items.length) {
      problems.push(
        input.label + " not assessed (" + (issues.size === 1 ? [...issues.keys()][0] : "no valid ground elevations") + ")"
      );
      perInput.push({ id: input.id, label: input.label, singular: input.singular, status: "failed", exposed: null, notAssessed: notAssessed });
      continue;
    }
    issues.forEach(function (count, why) {
      problems.push(count + " " + noun(input, count) + " not assessed (" + why + ")");
    });

    assessedInputs++;
    exposedCount += n;
    perInput.push({
      id: input.id,
      label: input.label,
      singular: input.singular,
      status: notAssessed > 0 ? "partial" : "ok",
      exposed: n,
      notAssessed: notAssessed
    });
  }

  unvalued.forEach(function (count, input) {
    problems.push("valuation unknown for " + count + " exposed " + noun(input, count));
  });

  const valueComplete = countComplete && unvalued.size === 0;
  const status = assessedInputs === 0 ? "unavailable" : valueComplete ? "complete" : "partial";

  return {
    status,
    waterZ,
    countComplete,
    valueComplete,
    // Counts and subtotals cover successfully assessed inputs only; `value`
    // is withheld (null) unless the whole result is complete.
    exposedCount: assessedInputs > 0 ? exposedCount : null,
    subtotal: assessedInputs > 0 ? subtotal : null,
    value: valueComplete ? subtotal : null,
    exposed,
    perInput,
    problems
  };
}

/**
 * Sampled share of today's dry land (above the reference surface) that lies at
 * or below the scenario surface. Invalid / no-data samples are excluded from
 * both numerator and denominator rather than treated as dry ground.
 */
export function summarizeCoverage(samples, referenceZ, waterZ) {
  let valid = 0;
  let belowReference = 0;
  let belowScenario = 0;
  for (const z of samples) {
    if (!isValidElevation(z)) continue;
    valid++;
    if (isAtOrBelowWater(z, referenceZ)) belowReference++;
    if (isAtOrBelowWater(z, waterZ)) belowScenario++;
  }
  const dryLand = valid - belowReference;
  const newlyBelow = Math.max(0, belowScenario - belowReference);
  return {
    total: samples.length,
    valid,
    invalid: samples.length - valid,
    dryLand,
    newlyBelow,
    pct: dryLand > 0 ? (newlyBelow / dryLand) * 100 : null
  };
}
