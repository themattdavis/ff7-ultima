"use strict";

import { DataType, readMemory, writeMemory } from "./memory";

// Code patch sites for the "Double Input Fix" (Steam FF7 1.02 English exe).
// Each site is only touched if the bytes currently there are EXACTLY what we
// expect. Other drivers/mods (FFNx and forks of it) rewrite call sites in this
// exe, so blindly writing "vanilla" bytes back over them corrupts the
// instruction and the game later jumps to a garbage address.
const SITES = [
  { address: 0x0041b09c, vanilla: 0x85e43d83, patched: 0x87343d83 },
  { address: 0x0041b0a9, vanilla: 0xfffab9e8, patched: 0xfffac6e8 },
];

export type DoubleInputFixResult = "applied" | "removed" | "already" | "skipped";

/**
 * Enable or disable the fix. Never writes unless every site holds the
 * expected bytes, so it is a no-op (returns "skipped") on an exe that has been
 * modified by something else.
 */
export async function applyDoubleInputFix(enable: boolean): Promise<DoubleInputFixResult> {
  const from = enable ? "vanilla" : "patched";
  const to = enable ? "patched" : "vanilla";

  const current: number[] = [];
  for (const site of SITES) {
    current.push((await readMemory(site.address, DataType.Int)) >>> 0);
  }

  // Already in the requested state: leave the code alone.
  if (SITES.every((s, i) => current[i] === s[to] >>> 0)) return "already";

  // Only proceed if all sites hold the expected source bytes (all-or-nothing).
  if (!SITES.every((s, i) => current[i] === s[from] >>> 0)) {
    console.warn(
      "Double Input Fix: unexpected bytes at patch sites, leaving them untouched",
      SITES.map((s, i) => `${s.address.toString(16)}=${current[i].toString(16)}`)
    );
    return "skipped";
  }

  for (const site of SITES) {
    await writeMemory(site.address, site[to], DataType.Int);
  }
  return enable ? "applied" : "removed";
}
