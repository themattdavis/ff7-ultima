/**
 * Step Graph math utilities
 * Ported from Big Shoes (constants.py / stepgraph_new.py) by the Ultima project.
 *
 * All arithmetic deliberately mirrors Python semantics:
 *   - Modulo on negatives: ((n % 256) + 256) % 256
 *   - Floor division:       Math.floor(n / d)
 */

// ─── Lookup tables ────────────────────────────────────────────────────────────

export const RNG: readonly number[] = [
  177, 202, 238, 108, 90,  113, 46,  85,  214, 0,   204, 153, 144, 107, 125, 235,
  79,  160, 7,   172, 223, 138, 86,  158, 241, 154, 99,  117, 17,  145, 163, 184,
  148, 115, 247, 84,  217, 110, 114, 192, 244, 128, 222, 185, 187, 141, 102, 38,
  208, 54,  225, 233, 112, 220, 205, 47,  74,  103, 93,  210, 96,  181, 157, 127,
  69,  55,  80,  68,  120, 4,   25,  44,  239, 253, 100, 129, 3,   218, 149, 76,
  122, 11,  173, 31,  186, 221, 62,  249, 215, 26,  41,  248, 24,  179, 32,  246,
  209, 94,  52,  146, 123, 36,  67,  136, 151, 212, 15,  53,  170, 131, 104, 39,
  168, 213, 190, 250, 20,  49,  175, 16,  13,  216, 106, 206, 35,  97,  243, 61,
  164, 8,   51,  227, 169, 56,  230, 147, 29,  28,  240, 14,  135, 89,  101, 130,
  188, 255, 254, 126, 143, 193, 30,  245, 203, 73,  2,   50,  9,   196, 142, 198,
  43,  64,  167, 23,  118, 59,  22,  42,  200, 251, 178, 88,  165, 21,  174, 37,
  207, 70,  199, 72,  180, 10,  63,  201, 6,   133, 81,  137, 98,  77,  18,  140,
  234, 162, 152, 75,  121, 111, 92,  71,  48,  27,  231, 197, 34,  156, 232, 150,
  58,  228, 124, 224, 105, 161, 183, 5,   57,  116, 1,   159, 189, 195, 132, 252,
  119, 134, 19,  78,  191, 242, 83,  91,  237, 33,  139, 109, 194, 65,  182, 219,
  60,  211, 40,  236, 45,  226, 155, 166, 66,  82,  87,  95,  229, 171, 176, 12,
];

// OFFSET_TABLE[n] = (13 * n) mod 256
export const OFFSET_TABLE: readonly number[] = [
    0,  13,  26,  39,  52,  65,  78,  91, 104, 117, 130, 143, 156, 169, 182, 195,
  208, 221, 234, 247,   4,  17,  30,  43,  56,  69,  82,  95, 108, 121, 134, 147,
  160, 173, 186, 199, 212, 225, 238, 251,   8,  21,  34,  47,  60,  73,  86,  99,
  112, 125, 138, 151, 164, 177, 190, 203, 216, 229, 242, 255,  12,  25,  38,  51,
   64,  77,  90, 103, 116, 129, 142, 155, 168, 181, 194, 207, 220, 233, 246,   3,
   16,  29,  42,  55,  68,  81,  94, 107, 120, 133, 146, 159, 172, 185, 198, 211,
  224, 237, 250,   7,  20,  33,  46,  59,  72,  85,  98, 111, 124, 137, 150, 163,
  176, 189, 202, 215, 228, 241, 254,  11,  24,  37,  50,  63,  76,  89, 102, 115,
  128, 141, 154, 167, 180, 193, 206, 219, 232, 245,   2,  15,  28,  41,  54,  67,
   80,  93, 106, 119, 132, 145, 158, 171, 184, 197, 210, 223, 236, 249,   6,  19,
   32,  45,  58,  71,  84,  97, 110, 123, 136, 149, 162, 175, 188, 201, 214, 227,
  240, 253,  10,  23,  36,  49,  62,  75,  88, 101, 114, 127, 140, 153, 166, 179,
  192, 205, 218, 231, 244,   1,  14,  27,  40,  53,  66,  79,  92, 105, 118, 131,
  144, 157, 170, 183, 196, 209, 222, 235, 248,   5,  18,  31,  44,  57,  70,  83,
   96, 109, 122, 135, 148, 161, 174, 187, 200, 213, 226, 239, 252,   9,  22,  35,
   48,  61,  74,  87, 100, 113, 126, 139, 152, 165, 178, 191, 204, 217, 230, 243,
];

// INVERSE_OFFSET_TABLE[x] = (197 * x) mod 256  (197 is the MMI of 13 mod 256)
export const INVERSE_OFFSET_TABLE: readonly number[] = [
    0, 197, 138,  79,  20, 217, 158,  99,  40, 237, 178, 119,  60,   1, 198, 139,
   80,  21, 218, 159, 100,  41, 238, 179, 120,  61,   2, 199, 140,  81,  22, 219,
  160, 101,  42, 239, 180, 121,  62,   3, 200, 141,  82,  23, 220, 161, 102,  43,
  240, 181, 122,  63,   4, 201, 142,  83,  24, 221, 162, 103,  44, 241, 182, 123,
   64,   5, 202, 143,  84,  25, 222, 163, 104,  45, 242, 183, 124,  65,   6, 203,
  144,  85,  26, 223, 164, 105,  46, 243, 184, 125,  66,   7, 204, 145,  86,  27,
  224, 165, 106,  47, 244, 185, 126,  67,   8, 205, 146,  87,  28, 225, 166, 107,
   48, 245, 186, 127,  68,   9, 206, 147,  88,  29, 226, 167, 108,  49, 246, 187,
  128,  69,  10, 207, 148,  89,  30, 227, 168, 109,  50, 247, 188, 129,  70,  11,
  208, 149,  90,  31, 228, 169, 110,  51, 248, 189, 130,  71,  12, 209, 150,  91,
   32, 229, 170, 111,  52, 249, 190, 131,  72,  13, 210, 151,  92,  33, 230, 171,
  112,  53, 250, 191, 132,  73,  14, 211, 152,  93,  34, 231, 172, 113,  54, 251,
  192, 133,  74,  15, 212, 153,  94,  35, 232, 173, 114,  55, 252, 193, 134,  75,
   16, 213, 154,  95,  36, 233, 174, 115,  56, 253, 194, 135,  76,  17, 214, 155,
   96,  37, 234, 175, 116,  57, 254, 195, 136,  77,  18, 215, 156,  97,  38, 235,
  176, 117,  58, 255, 196, 137,  78,  19, 216, 157,  98,  39, 236, 177, 118,  59,
];

// ─── Step position ────────────────────────────────────────────────────────────

export interface StepPos {
  stepId: number; // 0–255 (even values only in practice)
  offset: number; // 0–255, from OFFSET_TABLE
}

/**
 * Advance `pos` by `steps` (may be negative).
 * Mirrors Python's Step.__add__ / __sub__ arithmetic exactly.
 */
export function stepAdd(pos: StepPos, steps: number): StepPos {
  const newStepId = pos.stepId + 2 * steps;
  const newStepIdMod = ((newStepId % 256) + 256) % 256;
  const floorDiv = Math.floor(newStepId / 256);
  const offsetIdx = (((INVERSE_OFFSET_TABLE[pos.offset] + floorDiv) % 256) + 256) % 256;
  return { stepId: newStepIdMod, offset: OFFSET_TABLE[offsetIdx] };
}

/**
 * Integer distance (in steps) from `from` to `to`, in the range [0, 32767].
 * Mirrors Python's Step.distance_to_step.
 */
export function stepDistance(from: StepPos, to: StepPos): number {
  const diffOffset = INVERSE_OFFSET_TABLE[to.offset] - INVERSE_OFFSET_TABLE[from.offset];
  const diffStepId = to.stepId - from.stepId;
  const raw = Math.floor((256 * diffOffset + diffStepId) / 2);
  return ((raw % 32768) + 32768) % 32768;
}

// ─── Encounter logic ──────────────────────────────────────────────────────────

/**
 * Returns [dangerThreshold, isPreemptive] for the given step.
 * Mirrors Python's Step.encounter_threshold.
 */
export function encounterThreshold(
  pos: StepPos,
  lureRate: number,
  preemptRate: number,
): [number, boolean] {
  if (lureRate === 0) lureRate = 1;
  const rngVal = ((RNG[pos.stepId] - pos.offset) % 256 + 256) % 256;
  const dangerThreshold = (rngVal + 1) * Math.floor(4096 / lureRate);

  const prevPos = stepAdd(pos, -1);
  const preemptThreshold =
    ((RNG[(prevPos.stepId + 1) % 256] - prevPos.offset) % 256 + 256) % 256;
  const isPreemptive = preemptThreshold < preemptRate % 128;

  return [dangerThreshold, isPreemptive];
}

// ─── Projection lines ─────────────────────────────────────────────────────────

export interface ProjectionLine {
  /** -1 = pure-walk trajectory; ≥0 = N walking steps then switching to run */
  walkingSteps: number;
  /** X positions are distances in steps from leftEdgePos (may be negative = off-screen left) */
  startX: number;
  startDanger: number;
  endX: number;
  endDanger: number;
}

/** Convert a step position to a signed x-offset from the left edge (Big Shoes wrapping trick). */
function toPlotX(leftEdgePos: StepPos, pos: StepPos): number {
  let d = stepDistance(leftEdgePos, pos);
  if (d > 10000) d -= 32768; // wrap: steps to the left of the left edge become negative
  return d;
}

/**
 * Compute walk/run projection lines from the current step.
 * Mirrors Python's State.next_encounter_data.
 *
 * Returns an empty array when dipsRun <= dipsWalk or either is ≤ 0.
 */
export function computeNextEncounterData(
  startPos: StepPos,
  leftEdgePos: StepPos,
  startDanger: number,
  dipsRun: number,
  dipsWalk: number,
  lureRate: number,
  preemptRate: number,
): ProjectionLine[] {
  const result: ProjectionLine[] = [];

  if (dipsRun <= dipsWalk || dipsRun <= 0 || dipsWalk < 0) return result;

  let walkingSteps = 0;

  for (let outerIter = 0; outerIter < 500; outerIter++) {
    let totalSteps = walkingSteps + 1;
    let danger = startDanger + walkingSteps * dipsWalk + dipsRun;

    // Inner loop: advance by running until we hit a threshold
    let foundEncounter = false;
    for (let innerIter = 0; innerIter < 2000; innerIter++) {
      const [threshold] = encounterThreshold(
        stepAdd(startPos, totalSteps),
        lureRate,
        preemptRate,
      );
      if (danger >= threshold) {
        result.push({
          walkingSteps,
          startX: toPlotX(leftEdgePos, stepAdd(startPos, walkingSteps)),
          startDanger: startDanger + walkingSteps * dipsWalk,
          endX: toPlotX(leftEdgePos, stepAdd(startPos, totalSteps)),
          endDanger: danger,
        });
        foundEncounter = true;
        break;
      }
      danger += dipsRun;
      totalSteps++;
      if (danger > 65536) return result;
    }
    if (!foundEncounter) return result;

    const [maxThreshold] = encounterThreshold(
      stepAdd(startPos, totalSteps),
      lureRate,
      preemptRate,
    );
    const maxDanger = maxThreshold - 1;
    if (maxDanger < 0) break;

    const a = maxDanger - dipsRun * totalSteps;
    const newWalkingSteps = Math.ceil((startDanger - a) / (dipsRun - dipsWalk));

    if (newWalkingSteps > totalSteps) {
      // Pure-walk line. Mirrors Python exactly:
      //   out[-1] = (start_step, start_danger), (start_step + total_steps, start_danger + total_steps * dips_walk)
      // Python reuses totalSteps (the last run-encounter step count) as the x-endpoint — it does NOT
      // search for where walking alone would cross a threshold.
      result.push({
        walkingSteps: -1,
        startX: toPlotX(leftEdgePos, startPos),
        startDanger,
        endX: toPlotX(leftEdgePos, stepAdd(startPos, totalSteps)),
        endDanger: startDanger + totalSteps * dipsWalk,
      });
      return result;
    }

    walkingSteps = newWalkingSteps;
  }

  return result;
}
