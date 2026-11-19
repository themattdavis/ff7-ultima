import { Fragment, useEffect, useState } from "react";
import { FF7 } from "@/useFF7";
import { BattleRngSnapshot } from "@/types";

export function BattleRngMonitor(props: { ff7: FF7 }) {
  const [snapshot, setSnapshot] = useState<BattleRngSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Collapsed by default. While collapsed nothing is read from the game.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;

    let mounted = true;
    let reading = false;

    const refresh = async () => {
      if (reading) return;
      reading = true;

      try {
        const result = await props.ff7.readBattleRngSnapshot();
        if (mounted) {
          setSnapshot(result);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        reading = false;
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 250);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [props.ff7, expanded]);

  const cursors = snapshot?.cursors ?? [];

  return (
    <section className="rounded-md border border-zinc-700 bg-zinc-900/50 p-3">
      <button
        type="button"
        className={`flex w-full flex-wrap items-center justify-between gap-2 text-left ${expanded ? "mb-2" : ""}`}
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
      >
        <span className="flex items-center gap-2 font-semibold">
          <span className="inline-block w-3 text-xs text-zinc-400">{expanded ? "▾" : "▸"}</span>
          Battle RNG Monitor
        </span>
        {expanded && <span className="text-[10px] text-zinc-500">READ ONLY · 250 ms</span>}
      </button>

      {expanded && (
        <>
          {error && (
            <div className="mb-2 rounded bg-red-950/40 p-2 text-xs text-red-300">
              RNG read failed: {error}
            </div>
          )}

          {!snapshot && !error && (
            <div className="py-3 text-center text-xs text-zinc-500">
              Waiting for battle RNG data…
            </div>
          )}

          {snapshot && (
            <>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div className="rounded bg-zinc-800 p-2">
                  <div className="text-[10px] text-zinc-400">Active stream</div>
                  <div className="font-mono text-lg font-bold text-emerald-400">
                    {snapshot.active_stream}
                  </div>
                </div>
                <div className="rounded bg-zinc-800 p-2">
                  <div className="text-[10px] text-zinc-400">Rand16 calls</div>
                  <div className="font-mono text-lg font-bold">
                    {snapshot.call_count.toLocaleString()}
                  </div>
                </div>
                <div className="rounded bg-zinc-800 p-2">
                  <div className="text-[10px] text-zinc-400">Table size</div>
                  <div className="font-mono text-lg font-bold">256 bytes</div>
                </div>
              </div>

              <div className="mb-3">
                <div className="mb-1 text-xs font-medium text-zinc-300">Stream cursors</div>
                <div className="grid grid-cols-4 gap-1 sm:grid-cols-8">
                  {cursors.map((cursor, stream) => {
                    const active = stream === snapshot.active_stream;
                    return (
                      <div
                        key={stream}
                        className={`rounded px-2 py-1 text-center font-mono text-xs ${
                          active
                            ? "bg-emerald-700 text-white ring-1 ring-emerald-400"
                            : "bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        <div className="text-[10px] opacity-70">S{stream}</div>
                        {cursor.toString(16).padStart(2, "0").toUpperCase()}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium text-zinc-300">Random table</div>
                <div className="flex flex-wrap gap-2 text-[10px] text-zinc-400">
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-sky-700" />Cursor</span>
                  <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-600" />Active</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <div className="grid min-w-[440px] grid-cols-[28px_repeat(16,minmax(0,1fr))] gap-px font-mono text-[10px]">
                  {Array.from({ length: 16 }, (_, row) => (
                    <Fragment key={`row-${row}`}>
                      <div className="flex items-center justify-center text-zinc-500">
                        {row.toString(16).padStart(1, "0").toUpperCase()}0
                      </div>
                      {Array.from({ length: 16 }, (_, column) => {
                        const index = row * 16 + column;
                        const streams = cursors
                          .map((cursor, stream) => cursor === index ? stream : -1)
                          .filter(stream => stream >= 0);
                        const active = streams.includes(snapshot.active_stream);
                        const hasCursor = streams.length > 0;
                        const value = snapshot.random_table[index];

                        return (
                          <div
                            key={`byte-${index}`}
                            title={`Offset 0x${index.toString(16).padStart(2, "0").toUpperCase()}${streams.length ? ` · Cursor${streams.length > 1 ? "s" : ""}: ${streams.join(", ")}` : ""}`}
                            className={`flex h-6 items-center justify-center rounded-sm ${
                              active
                                ? "bg-emerald-600 font-bold text-white"
                                : hasCursor
                                  ? "bg-sky-800 text-white"
                                  : "bg-zinc-800 text-zinc-300"
                            }`}
                          >
                            {value?.toString(16).padStart(2, "0").toUpperCase() ?? "??"}
                          </div>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}