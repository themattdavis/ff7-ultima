import { useEffect, useState } from "react";
import { FF7 } from "@/useFF7";
import { BattleRngSnapshot } from "@/types";
import { musicList } from "@/ff7Music";
import BattleAutocomplete, { BattleFormationItem } from "@/components/BattleAutocomplete";
import { useFF7Context } from "@/FF7Context";
import { BattleRngMonitor } from "@/components/BattleRngMonitor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type SavedRngState = {
  id: string;
  name: string;
  snapshot: BattleRngSnapshot;
  createdAt: number;
};

type BattleEntry = {
  id: string;
  name: string;
  snapshotId: string;
  battleId?: number;
  musicId?: number;
};

const STATES_KEY = "ff7-ultima-scm-rng-states-v1";
const BATTLES_KEY = "ff7-ultima-scm-battle-table-v1";

function loadStored<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

const buttonClass =
  "rounded border border-zinc-600 px-3 py-1.5 text-xs hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed";

const inputClass =
  "rounded border border-zinc-600 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500";

export function SCM(props: { ff7: FF7 }) {
  const [snapshots, setSnapshots] = useState<SavedRngState[]>(
    () => loadStored(STATES_KEY, [])
  );
  const [battles, setBattles] = useState<BattleEntry[]>(
    () => loadStored(BATTLES_KEY, [])
  );
  const [stateName, setStateName] = useState("");
  const [battleName, setBattleName] = useState("");
  const [selectedStateId, setSelectedStateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [battleId, setBattleId] = useState<number | null>(null);
  const [musicId, setMusicId] = useState(0);
  const [battlePickerKey, setBattlePickerKey] = useState(0);

  const { gameData } = useFF7Context();
  const battleFormations: BattleFormationItem[] = [];
  gameData.battleScenes.forEach((scene, sceneIndex) => {
    scene.formations.forEach((formation, formationIndex) => {
      battleFormations.push({
        id: (sceneIndex * 4) + formationIndex,
        formation,
        enemies: scene.enemies,
      });
    });
  });

  useEffect(() => {
    localStorage.setItem(STATES_KEY, JSON.stringify(snapshots));
  }, [snapshots]);

  useEffect(() => {
    localStorage.setItem(BATTLES_KEY, JSON.stringify(battles));
  }, [battles]);

  const saveCurrentState = async () => {
    setBusy(true);
    setStatus("");

    try {
      const snapshot = await props.ff7.readBattleRngSnapshot();
      const name = stateName.trim() || `RNG State ${snapshots.length + 1}`;

      const saved: SavedRngState = {
        id: makeId(),
        name,
        snapshot,
        createdAt: Date.now(),
      };

      setSnapshots(current => [...current, saved]);
      setSelectedStateId(saved.id);
      setStateName("");
      setStatus(`Saved "${name}".`);
    } catch (error) {
      setStatus(`Could not save RNG state: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const restoreSnapshot = async (saved: SavedRngState) => {
    setBusy(true);
    setStatus("");

    try {
      await props.ff7.writeBattleRngSnapshot(saved.snapshot);
      setSelectedStateId(saved.id);
      setStatus(`Restored "${saved.name}" to FF7.`);
    } catch (error) {
      setStatus(`Could not restore RNG state: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const renameSnapshot = (saved: SavedRngState) => {
    const name = window.prompt("Rename RNG state:", saved.name);
    if (name === null || !name.trim()) return;

    setSnapshots(current =>
      current.map(item =>
        item.id === saved.id ? { ...item, name: name.trim() } : item
      )
    );
  };

  const deleteSnapshot = (saved: SavedRngState) => {
    if (!window.confirm(`Delete RNG state "${saved.name}"?`)) return;

    setSnapshots(current => current.filter(item => item.id !== saved.id));
    if (selectedStateId === saved.id) setSelectedStateId("");
  };

  const addBattle = () => {
    if (battleId === null) return;

    const name = battleName.trim() || `Battle ${battleId}`;
    setBattles(current => [
      ...current,
      {
        id: makeId(),
        name,
        snapshotId: "",
        battleId,
        musicId,
      },
    ]);

    setBattleName("");
    setBattleId(null);
    setMusicId(0);
    setBattlePickerKey(current => current + 1);
  };

  const updateBattle = (id: string, changes: Partial<BattleEntry>) => {
    setBattles(current =>
      current.map(item => item.id === id ? { ...item, ...changes } : item)
    );
  };

  const renameBattle = (battle: BattleEntry) => {
    const name = window.prompt("Rename battle:", battle.name);
    if (name === null || !name.trim()) return;
    updateBattle(battle.id, { name: name.trim() });
  };

  const deleteBattle = (battle: BattleEntry) => {
    if (!window.confirm(`Delete battle "${battle.name}"?`)) return;
    setBattles(current => current.filter(item => item.id !== battle.id));
  };

  const moveBattle = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= battles.length) return;

    setBattles(current => {
      const reordered = [...current];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return reordered;
    });
  };

  const startBattle = async (battle: BattleEntry) => {
    // No assigned state (or one that was deleted since) means the default RNG: the battle starts with
    // whatever the game's RNG is right now, nothing gets written to it.
    const saved = snapshots.find(item => item.id === battle.snapshotId);

    if (battle.battleId === undefined) {
      setStatus(`No battle formation is selected for "${battle.name}".`);
      return;
    }

    setBusy(true);
    setStatus("");

    try {
      if (saved) {
        await props.ff7.writeBattleRngSnapshot(saved.snapshot);
      }
      await props.ff7.startBattle(battle.battleId, battle.musicId ?? 0);
      setStatus(
        saved
          ? `Restored "${saved.name}" and started "${battle.name}".`
          : `Started "${battle.name}" with the default RNG.`,
      );
    } catch (error) {
      setStatus(`Could not start "${battle.name}": ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 pb-6">
      <section className="rounded-lg border border-zinc-700 bg-zinc-900/30 p-3">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">RNG States</h3>

          </div>
          <span className="text-xs text-zinc-500">
            {snapshots.length} saved
          </span>
        </div>

        <details className="mb-2">
          <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
            Save RNG State
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              className={`${inputClass} min-w-0 flex-1`}
              value={stateName}
              onChange={event => setStateName(event.target.value)}
              placeholder="Name this RNG state (optional)"
            />
            <button
              className={buttonClass}
              onClick={() => void saveCurrentState()}
              disabled={busy}
            >
              Save Current RNG
            </button>
          </div>
        </details>

        {snapshots.length === 0 ? (
          <p className="rounded bg-zinc-800/60 p-4 text-center text-sm text-zinc-500">
            No saved RNG states yet. Capture the current game state to get started.
          </p>
        ) : (
          <div className="space-y-1">
            {snapshots.map(saved => (
              <div
                key={saved.id}
                onClick={() => setSelectedStateId(saved.id)}
                className={`flex flex-wrap items-center justify-between gap-3 rounded border p-2 ${
                  selectedStateId === saved.id
                    ? "border-emerald-600 bg-emerald-950/20"
                    : "border-zinc-700 bg-zinc-800/40"
                }`}
              >
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => setSelectedStateId(saved.id)}
                >
                  <span className="block truncate text-sm font-medium">
                    {saved.name}
                  </span>
                  <span className="text-xs text-zinc-500">
                    Stream {saved.snapshot.active_stream}
                    {" · "}Rand16 {saved.snapshot.call_count}
                    {" · "}Cursors {saved.snapshot.cursors.length}
                  </span>
                </button>
                <div className="flex flex-wrap gap-1">
                  <button
                    className={buttonClass}
                    disabled={busy}
                    onClick={event => {
                      event.stopPropagation();
                      void restoreSnapshot(saved);
                    }}
                  >
                    Restore
                  </button>
                  <button
                    className={buttonClass}
                    onClick={event => {
                      event.stopPropagation();
                      renameSnapshot(saved);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className={`${buttonClass} text-red-300`}
                    onClick={event => {
                      event.stopPropagation();
                      deleteSnapshot(saved);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-700 bg-zinc-900/30 p-3">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold">Battle Table</h3>

          </div>
          <span className="text-xs text-zinc-500">
            {battles.length} battles
          </span>
        </div>

        <details className="mb-2">
          <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
            Add Battle
          </summary>
          <div className="mt-2 space-y-2">
          <input
            className={`${inputClass} w-full`}
            value={battleName}
            onChange={event => setBattleName(event.target.value)}
            placeholder="Battle name (optional)"
          />

          <BattleAutocomplete
            key={battlePickerKey}
            formations={battleFormations}
            isVisible={true}
            onSelect={setBattleId}
            placeholder="Search enemy, location, or battle ID"
          />

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-400">Battle music:</span>
            <Select
              value={String(musicId)}
              onValueChange={value => setMusicId(parseInt(value, 10))}
            >
              <SelectTrigger className="min-w-0 flex-1">
                <SelectValue placeholder="Select battle music" />
              </SelectTrigger>
              <SelectContent className="h-[200px]">
                {musicList.map((source, index) => (
                  <SelectItem key={index} value={String(index)}>
                    {source}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <button
              className={buttonClass}
              onClick={addBattle}
              disabled={battleId === null}
            >
              Add Battle
            </button>
          </div>
          </div>
        </details>

        {battles.length === 0 ? (
          <p className="rounded bg-zinc-800/60 p-4 text-center text-sm text-zinc-500">
            Your battle table is empty. Add a battle above.
          </p>
        ) : (
          <div className="space-y-1">
            {battles.map((battle, index) => {
              return (
                <div
                  key={battle.id}
                  className="rounded border border-zinc-700 bg-zinc-800/40 p-2"
                >
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="mr-2 text-xs text-zinc-500">
                        {index + 1}.
                      </span>
                      <span className="font-medium">{battle.name}</span>
                      <span className="ml-2 text-xs text-zinc-500">
                        ID {battle.battleId ?? "not selected"} · {musicList[battle.musicId ?? 0]}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <button
                        className={buttonClass}
                        disabled={index === 0}
                        onClick={() => moveBattle(index, -1)}
                        title="Move up"
                      >
                        ↑
                      </button>
                      <button
                        className={buttonClass}
                        disabled={index === battles.length - 1}
                        onClick={() => moveBattle(index, 1)}
                        title="Move down"
                      >
                        ↓
                      </button>
                      <button
                        className={buttonClass}
                        onClick={() => renameBattle(battle)}
                      >
                        Rename
                      </button>
                      <button
                        className={`${buttonClass} text-red-300`}
                        onClick={() => deleteBattle(battle)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className={`${inputClass} min-w-0 flex-1`}
                      value={battle.snapshotId}
                      onChange={event =>
                        updateBattle(battle.id, {
                          snapshotId: event.target.value,
                        })
                      }
                    >
                      <option value="">Default RNG</option>
                      {snapshots.map(saved => (
                        <option key={saved.id} value={saved.id}>
                          {saved.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className={`${buttonClass} border-emerald-700 text-emerald-300`}
                      disabled={busy || battle.battleId === undefined}
                      onClick={() => void startBattle(battle)}
                    >
                      Start
                    </button>
                  </div>

                </div>
              );
            })}
          </div>
        )}
      </section>

      {status && (
        <div
          role="status"
          className="rounded border border-zinc-700 bg-zinc-800/70 p-3 text-sm text-zinc-300"
        >
          {status}
        </div>
      )}

      <BattleRngMonitor ff7={props.ff7} />
    </div>
  );
}