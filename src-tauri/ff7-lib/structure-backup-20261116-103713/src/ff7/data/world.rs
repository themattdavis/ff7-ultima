use crate::ff7::addresses::FF7Addresses;
use crate::ff7::types::world::{WorldModel, WorldFieldTblItem, StoredTriangleSlot, WorldChunkSlot};
use crate::utils::memory::*;

pub const WORLD_CHUNK_SLOT_COUNT: usize = 32;
pub const WORLD_CHUNK_SLOT_STRIDE: u32 = 0x18;

pub fn read_world_chunk_slots(addresses: &FF7Addresses) -> Result<Vec<WorldChunkSlot>, String> {
    let mut slots = Vec::with_capacity(WORLD_CHUNK_SLOT_COUNT);
    for i in 0..WORLD_CHUNK_SLOT_COUNT {
        let base = addresses.world_chunk_headers + (i as u32) * WORLD_CHUNK_SLOT_STRIDE;
        slots.push(WorldChunkSlot {
            vertex_data_start: read_memory_int(base)? as u32,
            vertex_data_end: read_memory_int(base + 0x4)? as u32,
            chunk_x: read_memory_short(base + 0x8)?,
            chunk_z: read_memory_short(base + 0xA)?,
            unknown_e: read_memory_short(base + 0xC)?,
            unknown_f: read_memory_short(base + 0xE)?,
            triangle_data_ptr_unconfirmed: read_memory_int(base + 0x10)? as u32,
            slot_buffer_base: read_memory_int(base + 0x14)? as u32,
        });
    }
    Ok(slots)
}

// Slot 0's pointer at model+0x60 is a confirmed match against the PSX debug script's
// `st[0] = u32(CLOUD + 0x60)` (see read_world_current_model's pre-existing location_id lookup,
// which already read this same field under a different name). Ported from the PSX script's
// `st[i] = u32(CLOUD + 0x60 + i*8)`, `sto_x = u16(CLOUD + 0x64 + i*8)`, `sto_z = u16(CLOUD + 0x66 + i*8)`.
const STORED_TRIANGLE_SLOT_COUNT: usize = 6;
const STORED_TRIANGLE_SLOTS_BASE: u32 = 0x60;
const STORED_TRIANGLE_SLOT_STRIDE: u32 = 0x8;

fn read_stored_triangle_slots(
    model_address: u32,
) -> Result<[StoredTriangleSlot; STORED_TRIANGLE_SLOT_COUNT], String> {
    let mut slots = [StoredTriangleSlot::default(); STORED_TRIANGLE_SLOT_COUNT];
    for (i, slot) in slots.iter_mut().enumerate() {
        let slot_addr = model_address + STORED_TRIANGLE_SLOTS_BASE + (i as u32) * STORED_TRIANGLE_SLOT_STRIDE;
        *slot = StoredTriangleSlot {
            triangle_ptr: read_memory_int(slot_addr)? as u32,
            chunk_x: read_memory_short(slot_addr + 0x4)?,
            chunk_z: read_memory_short(slot_addr + 0x6)?,
        };
    }
    Ok(slots)
}

pub fn read_world_current_model(addresses: &FF7Addresses) -> Result<WorldModel, String> {
    let address = read_memory_int(addresses.world_current_obj_ptr)? as u32;
    if address == 0 {
        return Ok(WorldModel {
            index: 0,
            x: 0,
            y: 0,
            z: 0,
            direction: 0,
            model_id: 0,
            walkmesh_type: 0,
            location_id: 0,
            chocobo_tracks: false,
            stored_triangles: [StoredTriangleSlot::default(); STORED_TRIANGLE_SLOT_COUNT],
        });
    }

    let stored_triangles = read_stored_triangle_slots(address)?;
    let triangle_ptr = stored_triangles[0].triangle_ptr;
    let mut location_id = 255;
    if triangle_ptr != 0 {
        location_id = ((read_memory_byte(triangle_ptr + 0xb)? as u8) & 0x7f) >> 1;
    }

    Ok(WorldModel {
        index: 0,
        x: read_memory_int(address + 0xC)?,
        y: read_memory_signed_int(address + 0x10)?,
        z: read_memory_int(address + 0x14)?,
        direction: read_memory_signed_short(address + 0x40)?,
        model_id: read_memory_byte(address + 0x50)?,
        walkmesh_type: read_memory_byte(address + 0x4a)?,
        location_id,
        chocobo_tracks: (read_memory_byte(address + 0x4b)? >> 7 & 1) != 0,
        stored_triangles,
    })
}

pub fn read_world_models(addresses: &FF7Addresses) -> Result<Vec<WorldModel>, String> {
    let mut models: Vec<WorldModel> = Vec::new();
    let model_record_length = 192;

    for i in 0..16 {
        let model_check =
            read_memory_int(addresses.world_models + i * model_record_length + 188)? as u32;
        if model_check == 0 {
            continue;
        }

        let model = WorldModel {
            index: i as u8,
            x: read_memory_int(addresses.world_models + i * model_record_length + 0xC)?,
            y: read_memory_signed_int(addresses.world_models + i * model_record_length + 0x10)?,
            z: read_memory_int(addresses.world_models + i * model_record_length + 0x14)?,
            direction: read_memory_signed_short(
                addresses.world_models + i * model_record_length + 0x40,
            )?,
            model_id: read_memory_byte(addresses.world_models + i * model_record_length + 0x50)?,
            walkmesh_type: 0,
            location_id: 0,
            chocobo_tracks: false,
            // Not read for non-player models - the PSX script only ever inspects CLOUD's slots,
            // and reading 6 slots * 16 models every poll for data nothing uses isn't worth it.
            stored_triangles: [StoredTriangleSlot::default(); STORED_TRIANGLE_SLOT_COUNT],
        };
        models.push(model);
    }
    Ok(models)
}

pub fn get_chocobo_rating_for_scene(scene_id: u32) -> Result<u32, String> {
    let addresses = FF7Addresses::new();
    let chocobo_ratings_base = addresses.world_enc_w_bin_data + 0x20;

    for i in 0..32 {
        let scene_id_from_memory = read_memory_byte(chocobo_ratings_base + i * 4)? as u32;
        if scene_id_from_memory == scene_id {
            return Ok(read_memory_byte(chocobo_ratings_base + i * 4 + 2)? as u32);
        }
    }

    Ok(0)
}

pub fn read_world_field_tbl_data(addresses: &FF7Addresses) -> Result<Vec<WorldFieldTblItem>, String> {
    let mut items: Vec<WorldFieldTblItem> = Vec::new();
    for i in 0..64 {
        let item = WorldFieldTblItem {
            x: read_memory_signed_short(addresses.world_field_tbl_data + i * 24 + 0x00)?,
            y: read_memory_signed_short(addresses.world_field_tbl_data + i * 24 + 0x02)?,
            triangle_id: read_memory_short(addresses.world_field_tbl_data + i * 24 + 0x04)?,
            field_id: read_memory_short(addresses.world_field_tbl_data + i * 24 + 0x06)?,
            direction: read_memory_byte(addresses.world_field_tbl_data + i * 24 + 0x08)?,
        };
        items.push(item);
    }
    Ok(items)
}
