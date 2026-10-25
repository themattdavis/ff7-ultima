use crate::ff7::addresses::FF7Addresses;
use crate::ff7::types::general::{FF7BasicData};
use crate::utils::memory::*;

pub fn read_basic_data(addresses: &FF7Addresses) -> Result<FF7BasicData, String> {
    let party_member_ids_vec = vec![
        read_memory_byte(addresses.party_member_ids)?,
        read_memory_byte(addresses.party_member_ids + 1)?,
        read_memory_byte(addresses.party_member_ids + 2)?,
    ];

    let zolom_current_ptr = read_memory_int(addresses.zolom_current_ptr)?;
    let zolom_coords = if zolom_current_ptr == 0 {
        0
    } else {
        read_memory_int(zolom_current_ptr)?
    };

    let slots_active = if read_memory_byte(addresses.slots_active)? > 0 {
        1
    } else if read_memory_byte(addresses.slots_active + 1)? > 0 {
        2
    } else if read_memory_byte(addresses.slots_active + 2)? > 0 {
        3
    } else {
        0
    };

    let current_module = read_memory_byte(addresses.current_module)?;

    Ok(FF7BasicData {
        current_module: current_module,
        game_moment: read_memory_short(addresses.game_moment)?,
        field_id: read_memory_short(addresses.field_id)?,
        field_fps: read_memory_float(addresses.field_fps)?,
        field_current_model_id: read_memory_short(addresses.field_current_model_id)?,
        battle_fps: read_memory_float(addresses.battle_fps)?,
        world_fps: read_memory_float(addresses.world_fps)?,
        in_game_time: read_memory_int(addresses.in_game_time)?,
        disc_id: read_memory_byte(addresses.disc_id)?,
        menu_visibility: read_memory_short(addresses.menu_visibility)?,
        menu_locks: read_memory_short(addresses.menu_locks)?,
        field_movement_disabled: read_memory_byte(addresses.field_movement_disabled)?,
        field_menu_access_enabled: read_memory_byte(addresses.field_menu_access_enabled)?,
        field_alt_encounters_enabled: read_memory_byte(addresses.field_alt_encounters_enabled)?,
        party_locking_mask: read_memory_short(addresses.party_locking_mask)?,
        party_visibility_mask: read_memory_short(addresses.party_visibility_mask)?,
        gil: read_memory_int(addresses.gil)?,
        gp: read_memory_short(addresses.gp)?,
        battle_count: read_memory_short(addresses.battle_count)?,
        battle_escape_count: read_memory_short(addresses.battle_escape_count)?,
        field_battle_check: read_memory_int(addresses.field_battle_check)?,
        game_obj_ptr: read_memory_int(addresses.game_obj_ptr)?,
        battle_swirl_check: read_memory_byte(addresses.battle_swirl_check)?,
        instant_atb_check: read_memory_short(addresses.instant_atb_check)?,
        unfocus_patch_check: read_memory_byte(addresses.unfocus_patch_check)?,
        ffnx_check: read_memory_byte(addresses.ffnx_check)?,
        step_id: read_memory_int(addresses.step_id)?,
        step_offset: read_memory_int(addresses.step_offset)?,
        step_fraction: read_memory_int(addresses.step_fraction)?,
        danger_value: read_memory_int(addresses.danger_value)?,
        formation_idx: read_memory_byte(addresses.formation_idx)?,
        battle_id: read_memory_short(addresses.battle_id)?,
        invincibility_check: read_memory_short(addresses.battle_init_chars_call)?,
        exp_multiplier: read_memory_byte(addresses.battle_exp_calc + 8)?,
        exp_multiplier_mode: read_memory_byte(addresses.battle_exp_calc + 6)?,
        gil_multiplier: read_memory_byte(addresses.battle_exp_calc + 35)?,
        gil_multiplier_mode: read_memory_byte(addresses.battle_exp_calc + 33)?,
        ap_multiplier: read_memory_byte(addresses.battle_ap_calc + 2)?,
        ap_multiplier_mode: read_memory_byte(addresses.battle_ap_calc)?,
        battle_chocobo_rating: read_memory_byte(addresses.battle_chocobo_rating)?,
        menu_always_enabled: read_memory_byte(addresses.menu_always_enabled)?,
        world_zoom_tilt_enabled: read_memory_byte(addresses.world_zoom_tilt_enabled)?,
        world_zoom: read_memory_short(addresses.world_zoom)?,
        world_tilt: read_memory_short(addresses.world_tilt)?,
        world_speed_multiplier: read_memory_byte(addresses.world_speed_multiplier)?,
        party_member_ids: party_member_ids_vec,
        key_items: read_memory_buffer(addresses.key_items, 8)?,
        zolom_coords: zolom_coords,
        world_map_type: read_memory_byte(addresses.world_map_type)?,
        field_skip_dialogues_check: read_memory_byte(addresses.field_skip_dialogues)?,
        field_tmp_vars: read_memory_buffer(addresses.field_script_temp_vars, 0x20)?,
        battle_queue: read_memory_buffer(addresses.battle_queue, 8)?,
        manual_slots_check: read_memory_byte(addresses.cait_manual_slots)?,
        slots_active: slots_active,
        walk_anywhere_check: read_memory_byte(addresses.world_walk_anywhere_1)?,
        love_points: read_memory_buffer(addresses.love_points, 4)?,
        battle_points: read_memory_short(addresses.battle_points)?,
        auto_sense_check: read_memory_byte(addresses.auto_sense_check)?,
        field_run_by_default_check: read_memory_byte(addresses.field_run_by_default_1)?,
    })
}

pub fn read_variables_bank(bank: u32, addresses: &FF7Addresses) -> Result<Vec<u8>, String> {
    if bank == 6 {
        Ok(read_memory_buffer(addresses.field_script_temp_vars, 0x100)?)
    } else {
        Ok(read_memory_buffer(addresses.savemap + 0xba4 + (bank - 1) * 0x100, 0x100)?)
    }
}

pub fn write_variable_8bit(bank: u32, address: u32, value: u8, addresses: &FF7Addresses) -> Result<(), String> {
    if bank == 6 {
        write_memory_byte(addresses.field_script_temp_vars + address, value)?;
    } else {
        write_memory_byte(addresses.savemap + 0xba4 + (bank - 1) * 0x100 + address, value)?;
    }
    Ok(())
}

pub fn write_variable_16bit(bank: u32, address: u32, value: u16, addresses: &FF7Addresses) -> Result<(), String> {
    if bank == 6 {
        write_memory_short(addresses.field_script_temp_vars + address, value)?;
    } else {
        write_memory_short(addresses.savemap + 0xba4 + (bank - 1) * 0x100 + address, value)?;
    }
    Ok(())
}

