//! World-map streaming snapshots ("chunk/triangle data") for world save states.
//!
//! What the game keeps for the terrain around the player (from the PC decomp, wm_world_terrain_streaming.cpp):
//!
//! * One fixed block of globals at 0xE045F8..0xE28CE0. It holds the block/mesh pools, the load and
//!   decompress queues, the resident chunk list (`g_WorldStreamingState`), the 32 chunk records, and, at
//!   0xE04970 (`g_WorldMeshLoadState`), the 32 x 0x1200 byte store of DECOMPRESSED chunks (vertices,
//!   triangles). All pointers in there point at other fixed addresses in the same block, so the block can be
//!   copied back verbatim. The one exception is `g_WorldStreamingSlot` (0xE045FC), which points into the
//!   world arena. The arena is heap allocated, so its address differs after every world load.
//! * The 9 raw 0xB800 byte terrain blocks that the chunks are decompressed from. They live in arena region 6
//!   at `g_WorldStreamingSlot`. They hold file data (offset tables, LZS streams), no pointers.
//!
//! A snapshot is those two byte ranges. On restore any dword in the control part of the block (everything
//! except the decompressed mesh store, whose contents are plain vertex/triangle data) that points into the old
//! block-buffer range is moved by the difference between the old and the new `g_WorldStreamingSlot`.
//! That covers `g_WorldStreamingSlot` itself and any other stored arena pointer.

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;
use std::io::{Read, Write};

pub const MAGIC: &[u8; 8] = b"FF7WSNP1";
pub const VERSION: u32 = 1;

/// First and last+1 address of the streaming globals block.
pub const STREAM_BSS_START: u32 = 0x00E0_45F8;
pub const STREAM_BSS_END: u32 = 0x00E2_8CE0;
/// `g_WorldStreamingSlot`: base of the 9 raw terrain block buffers.
pub const STREAMING_SLOT_PTR: u32 = 0x00E0_45FC;
pub const BLOCK_SLOT_SIZE: u32 = 0xB800;
pub const BLOCK_SLOT_COUNT: u32 = 9;
/// `g_WorldMeshLoadState`: 32 decompressed chunks of 0x1200 bytes (plain data, never relocated).
pub const MESH_STORE_START: u32 = 0x00E0_4970;
pub const MESH_STORE_END: u32 = 0x00E2_8970;

pub const BSS_LEN: u32 = STREAM_BSS_END - STREAM_BSS_START;
pub const BLOCKS_LEN: u32 = BLOCK_SLOT_SIZE * BLOCK_SLOT_COUNT;

#[derive(Debug, PartialEq, Eq)]
pub struct Snapshot {
    /// `g_WorldStreamingSlot` at capture time.
    pub slot_base: u32,
    pub bss: Vec<u8>,
    pub blocks: Vec<u8>,
}

fn put_u32(out: &mut Vec<u8>, v: u32) {
    out.extend_from_slice(&v.to_le_bytes());
}

fn get_u32(data: &[u8], pos: &mut usize) -> Result<u32, String> {
    let end = *pos + 4;
    let bytes = data.get(*pos..end).ok_or("snapshot file is truncated")?;
    *pos = end;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

/// Serialises a snapshot (gzip compressed).
pub fn encode(snapshot: &Snapshot) -> Result<Vec<u8>, String> {
    if snapshot.bss.len() as u32 != BSS_LEN || snapshot.blocks.len() as u32 != BLOCKS_LEN {
        return Err("snapshot has the wrong size".to_string());
    }
    let mut raw = Vec::with_capacity(32 + snapshot.bss.len() + snapshot.blocks.len());
    raw.extend_from_slice(MAGIC);
    put_u32(&mut raw, VERSION);
    put_u32(&mut raw, snapshot.slot_base);
    put_u32(&mut raw, STREAM_BSS_START);
    put_u32(&mut raw, BSS_LEN);
    put_u32(&mut raw, BLOCKS_LEN);
    raw.extend_from_slice(&snapshot.bss);
    raw.extend_from_slice(&snapshot.blocks);

    let mut enc = GzEncoder::new(Vec::new(), Compression::fast());
    enc.write_all(&raw).map_err(|e| e.to_string())?;
    enc.finish().map_err(|e| e.to_string())
}

pub fn decode(compressed: &[u8]) -> Result<Snapshot, String> {
    let mut raw = Vec::new();
    GzDecoder::new(compressed)
        .read_to_end(&mut raw)
        .map_err(|e| format!("snapshot file is not valid: {e}"))?;
    if raw.get(..8) != Some(&MAGIC[..]) {
        return Err("not a world stream snapshot".to_string());
    }
    let mut pos = 8usize;
    let version = get_u32(&raw, &mut pos)?;
    if version != VERSION {
        return Err(format!("unsupported snapshot version {version}"));
    }
    let slot_base = get_u32(&raw, &mut pos)?;
    let bss_start = get_u32(&raw, &mut pos)?;
    let bss_len = get_u32(&raw, &mut pos)?;
    let blocks_len = get_u32(&raw, &mut pos)?;
    if bss_start != STREAM_BSS_START || bss_len != BSS_LEN || blocks_len != BLOCKS_LEN {
        return Err("snapshot was made for a different memory layout".to_string());
    }
    let bss_end = pos + bss_len as usize;
    let blocks_end = bss_end + blocks_len as usize;
    if raw.len() != blocks_end {
        return Err("snapshot file has the wrong length".to_string());
    }
    Ok(Snapshot {
        slot_base,
        bss: raw[pos..bss_end].to_vec(),
        blocks: raw[bss_end..blocks_end].to_vec(),
    })
}

/// Moves every dword in the control part of `bss` (all of it except the decompressed mesh store) that points
/// into the old block-buffer range by `new_base - old_base`. Returns how many dwords were moved.
pub fn relocate_arena_pointers(bss: &mut [u8], old_base: u32, new_base: u32) -> u32 {
    if old_base == new_base {
        return 0;
    }
    let old_end = old_base.wrapping_add(BLOCKS_LEN);
    let mut moved = 0;
    let mesh_lo = (MESH_STORE_START - STREAM_BSS_START) as usize;
    let mesh_hi = (MESH_STORE_END - STREAM_BSS_START) as usize;
    // Everything is 4-byte aligned relative to the block start (0xE045F8 is 4-aligned).
    let mut off = 0usize;
    while off + 4 <= bss.len() {
        if off >= mesh_lo && off < mesh_hi {
            off = mesh_hi;
            continue;
        }
        let v = u32::from_le_bytes([bss[off], bss[off + 1], bss[off + 2], bss[off + 3]]);
        if v >= old_base && v < old_end {
            let nv = v.wrapping_sub(old_base).wrapping_add(new_base);
            bss[off..off + 4].copy_from_slice(&nv.to_le_bytes());
            moved += 1;
        }
        off += 4;
    }
    moved
}

// ── Game memory side ────────────────────────────────────────────────────────

use ff7_lib::utils::memory;
use std::path::{Path, PathBuf};
use tauri::Manager;

fn state_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("world_states");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn state_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    // The id becomes a file name: only the characters of a UUID are allowed.
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("invalid state id".to_string());
    }
    Ok(state_dir(app)?.join(format!("{id}.wsnap")))
}

fn write_file(path: &Path, data: &[u8]) -> Result<(), String> {
    // Write next to the target and rename, so an interrupted write never leaves a half file.
    let tmp = path.with_extension("wsnap.tmp");
    std::fs::write(&tmp, data).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Reads the streaming state out of the running game.
/// The caller has to hold the game thread (at the frame flip) so the lists are consistent.
fn read_snapshot() -> Result<Snapshot, String> {
    let slot_base = memory::read_memory_int(STREAMING_SLOT_PTR)?;
    if slot_base == 0 {
        return Err("the world map is not loaded (no block buffers)".to_string());
    }
    let bss = memory::read_memory_buffer(STREAM_BSS_START, BSS_LEN as usize)?;
    let blocks = memory::read_memory_buffer(slot_base, BLOCKS_LEN as usize)?;
    // The pointer must not have moved while reading (it only changes when the world is left or entered).
    if memory::read_memory_int(STREAMING_SLOT_PTR)? != slot_base {
        return Err("the world map changed while the snapshot was taken".to_string());
    }
    Ok(Snapshot { slot_base, bss, blocks })
}

#[tauri::command]
pub fn capture_world_stream(app: tauri::AppHandle, id: String) -> Result<u32, String> {
    let path = state_path(&app, &id)?;
    let encoded = encode(&read_snapshot()?)?;
    write_file(&path, &encoded)?;
    Ok(encoded.len() as u32)
}

#[derive(serde::Serialize)]
pub struct RestoreReport {
    pub relocated: u32,
    pub moved_by: i64,
}

/// Writes a snapshot back. The caller has to hold the game thread and the world map has to be fully loaded.
#[tauri::command]
pub fn restore_world_stream(app: tauri::AppHandle, id: String) -> Result<RestoreReport, String> {
    let path = state_path(&app, &id)?;
    let mut snapshot = decode(&std::fs::read(&path).map_err(|e| format!("no chunk data file: {e}"))?)?;

    let new_base = memory::read_memory_int(STREAMING_SLOT_PTR)?;
    if new_base == 0 {
        return Err("the world map is not loaded (no block buffers)".to_string());
    }
    let relocated = relocate_arena_pointers(&mut snapshot.bss, snapshot.slot_base, new_base);
    // Block buffers first, then the lists that refer to them.
    memory::write_memory_buffer(new_base, snapshot.blocks)?;
    memory::write_memory_buffer(STREAM_BSS_START, snapshot.bss)?;
    Ok(RestoreReport {
        relocated,
        moved_by: new_base as i64 - snapshot.slot_base as i64,
    })
}

#[tauri::command]
pub fn has_world_stream(app: tauri::AppHandle, id: String) -> Result<bool, String> {
    Ok(state_path(&app, &id)?.exists())
}

#[tauri::command]
pub fn delete_world_streams(app: tauri::AppHandle, ids: Vec<String>) -> Result<(), String> {
    for id in ids {
        let path = state_path(&app, &id)?;
        if path.exists() {
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// The compressed snapshot file, for exporting states.
#[tauri::command]
pub fn export_world_stream(app: tauri::AppHandle, id: String) -> Result<Vec<u8>, String> {
    std::fs::read(state_path(&app, &id)?).map_err(|e| e.to_string())
}

/// Stores a snapshot file from an export. It is decoded first, so a corrupt file is refused.
#[tauri::command]
pub fn import_world_stream(app: tauri::AppHandle, id: String, data: Vec<u8>) -> Result<(), String> {
    decode(&data)?;
    write_file(&state_path(&app, &id)?, &data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(slot_base: u32) -> Snapshot {
        let mut bss = vec![0u8; BSS_LEN as usize];
        for (i, b) in bss.iter_mut().enumerate() {
            *b = (i * 7 + 3) as u8;
        }
        // g_WorldStreamingSlot
        let slot_off = (STREAMING_SLOT_PTR - STREAM_BSS_START) as usize;
        bss[slot_off..slot_off + 4].copy_from_slice(&slot_base.to_le_bytes());
        Snapshot { slot_base, bss, blocks: vec![0xAB; BLOCKS_LEN as usize] }
    }

    #[test]
    fn round_trip() {
        let s = sample(0x0A00_0000);
        assert_eq!(decode(&encode(&s).unwrap()).unwrap(), s);
    }

    #[test]
    fn rejects_garbage_and_wrong_layout() {
        assert!(decode(b"nope").is_err());
        let mut s = sample(0x0A00_0000);
        s.bss.pop();
        assert!(encode(&s).is_err());
    }

    #[test]
    fn relocation_moves_slot_pointer_but_not_mesh_store() {
        let old = 0x0A10_0000u32;
        let new = 0x0B20_0010u32;
        let mut s = sample(old);
        // an extra arena pointer in the control part (a block node into the buffers)
        let ctl = 0x40usize;
        s.bss[ctl..ctl + 4].copy_from_slice(&(old + 0xB800).to_le_bytes());
        // the same value inside the mesh store has to stay as it is
        let mesh = (MESH_STORE_START - STREAM_BSS_START) as usize + 0x100;
        s.bss[mesh..mesh + 4].copy_from_slice(&(old + 0xB800).to_le_bytes());
        // a pointer to a fixed address (BSS) has to stay as it is
        let fixed = 0x44usize;
        s.bss[fixed..fixed + 4].copy_from_slice(&0x00E0_4610u32.to_le_bytes());

        let slot_off = (STREAMING_SLOT_PTR - STREAM_BSS_START) as usize;
        let moved = relocate_arena_pointers(&mut s.bss, old, new);
        let rd = |b: &[u8], o: usize| u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]);
        assert!(moved >= 2);
        assert_eq!(rd(&s.bss, slot_off), new);
        assert_eq!(rd(&s.bss, ctl), new + 0xB800);
        assert_eq!(rd(&s.bss, mesh), old + 0xB800);
        assert_eq!(rd(&s.bss, fixed), 0x00E0_4610);
    }

    #[test]
    fn relocation_is_a_no_op_for_the_same_base() {
        let mut s = sample(0x0A00_0000);
        let before = s.bss.clone();
        assert_eq!(relocate_arena_pointers(&mut s.bss, 0x0A00_0000, 0x0A00_0000), 0);
        assert_eq!(s.bss, before);
    }
}
