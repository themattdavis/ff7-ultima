use serde::Serialize;

// One entry in the current model's 6-slot "recently resolved triangle" cache, at model+0x60..0x90
// (8 bytes/slot: u32 triangle pointer, u16 chunk_x, u16 chunk_z it was resolved against). Offset
// 0x60 for slot 0 is confirmed identical to the PSX build (same field, same offset, in
// read_world_current_model's existing location_id lookup) - the rest of this layout is inferred by
// extension from that anchor and from the equivalent PSX debug script, not independently verified.
#[derive(Serialize, Clone, Copy, Default)]
pub struct StoredTriangleSlot {
    pub triangle_ptr: u32,
    pub chunk_x: u16,
    pub chunk_z: u16,
}

/// One of the 32 fixed-size slots in the World Map's chunk-streaming table, 0x18 (24) bytes each.
/// Reverse-engineered from live memory (not from any known PC decompilation) - see field comments
/// for confidence level on each part.
#[derive(Serialize, Clone, Copy, Default)]
pub struct WorldChunkSlot {
    /// Confirmed via statistical analysis across all 31 non-empty slots observed: `vertex_data_end -
    /// vertex_data_start` was an exact multiple of 8 in every case, with no exceptions - so this
    /// bounds an 8-byte-record list. Per the community reference documentation, both vertex
    /// positions and vertex normals use this exact 8-byte format (3x i16 coordinate + 2 bytes
    /// padding), and a chunk has equal counts of each - so it's confirmed to be ONE of those two
    /// lists, just not yet confirmed which.
    pub vertex_data_start: u32,
    pub vertex_data_end: u32,
    pub chunk_x: u16,
    pub chunk_z: u16,
    /// Not yet identified. Observed range so far: roughly 120-210.
    pub unknown_e: u16,
    /// Not yet identified. Observed range so far: 0-10, much narrower than unknown_e - possibly a
    /// priority/LRU counter related to the active/inactive chunk ordering.
    pub unknown_f: u16,
    /// UNCONFIRMED. Best guess is the triangle-data list pointer (matching the PSX debug script's
    /// wmc_tri field), based on: (a) it clusters in a much smaller, tighter address range than the
    /// other pointers here, consistent with the shared triangle arena being far smaller than the
    /// per-slot vertex/normal buffers, and (b) that's where the PSX layout put its triangle
    /// pointer. NOT yet verified by inspecting the actual pointed-to bytes for the 12-byte
    /// triangle-record pattern - treat this field's meaning as a placeholder until confirmed.
    pub triangle_data_ptr_unconfirmed: u32,
    /// Confirmed: increases by exactly 0x1200 (4608) bytes between every consecutive slot, with
    /// zero deviation across all 31 slots observed - matching the community documentation's stated
    /// ~4.5 KB per-chunk buffer size (4608 / 1024 = 4.5 exactly) precisely. This is the slot's own
    /// fixed physical buffer base address (slot_buffer_base = table_base_constant + index * 0x1200),
    /// not chunk-specific data - it's the same value for a given slot index regardless of which
    /// chunk is currently loaded there.
    pub slot_buffer_base: u32,
}

#[derive(Serialize)]
pub struct WorldModel {
    pub index: u8,
    pub x: u32,
    pub y: i32,
    pub z: u32,
    pub direction: i16,
    pub model_id: u8,
    pub walkmesh_type: u8,
    pub location_id: u8,
    pub chocobo_tracks: bool,
    pub stored_triangles: [StoredTriangleSlot; 6],
}

/*
short	x
short	y
short	triangleId
ushort	fieldId
byte	direction
byte[3]	padding
*/
#[derive(Serialize)]
pub struct WorldFieldTblItem {
    pub x: i16,
    pub y: i16,
    pub triangle_id: u16,
    pub field_id: u16,
    pub direction: u8,
}
