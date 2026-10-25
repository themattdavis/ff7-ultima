use crate::ff7::addresses::FF7Addresses;
use crate::ff7::types::chocobos::{ChocoboData, ChocoboSlot, FencedChocobo};
use crate::ff7::data::kernel::read_name;
use crate::utils::memory::*;

pub fn read_chocobo_data(addresses: &FF7Addresses) -> Result<ChocoboData, String> {
    let savemap = addresses.savemap;
    
    // Read fenced chocobo ratings (penned chocobos 1-4)
    let mut fenced_chocobos = [FencedChocobo { rating: 0 }; 4];
    for i in 0..4 {
        let rating = read_memory_byte(savemap + 0x0BF9 + i)?;
        fenced_chocobos[i as usize] = FencedChocobo { rating };
    }
    
    // Read stable counts and masks
    let stables_owned = read_memory_byte(savemap + 0x0CFC)?;
    let occupied_stables = read_memory_byte(savemap + 0x0CFD)?;
    let stables_occupied_mask = read_memory_byte(savemap + 0x0CFF)?;
    let cant_mate_mask = read_memory_byte(savemap + 0x0D00)?;
    
    // Read stable chocobo slots
    let mut stable_chocobos = [None; 6];
    let slot_offsets = [0x0DC4, 0x0DD4, 0x0DE4, 0x0DF4, 0x1084, 0x1094];
    
    for (i, &offset) in slot_offsets.iter().enumerate() {
        // Check if this stable is occupied
        let stable_bit = 1 << i;
        if (stables_occupied_mask & stable_bit) != 0 {
            let base_addr = savemap + offset;
            
            stable_chocobos[i] = Some(ChocoboSlot {
                sprint_speed: read_memory_short(base_addr + 0x0)?,
                max_sprint_speed: read_memory_short(base_addr + 0x2)?,
                speed: read_memory_short(base_addr + 0x4)?,
                max_speed: read_memory_short(base_addr + 0x6)?,
                acceleration: read_memory_byte(base_addr + 0x8)?,
                cooperation: read_memory_byte(base_addr + 0x9)?,
                intelligence: read_memory_byte(base_addr + 0xA)?,
                personality: read_memory_byte(base_addr + 0xB)?,
                pcount: read_memory_byte(base_addr + 0xC)?,
                races_won: read_memory_byte(base_addr + 0xD)?,
                sex: read_memory_byte(base_addr + 0xE)?,
                color: read_memory_byte(base_addr + 0xF)?,
                rating: read_memory_byte(savemap + 0xE3E + i as u32)?,
            });
        }
    }
    
    // Read chocobo names (6 bytes each in FF text format)
    let mut chocobo_names = [String::new(), String::new(), String::new(), String::new(), String::new(), String::new()];
    for i in 0..6 {
        let name_addr = savemap + 0x0EC4 + (i * 6) as u32;
        chocobo_names[i] = read_name(name_addr, 6)?;
    }
    
    // Read chocobo stamina values (2 bytes each)
    let mut chocobo_stamina = [0u16; 6];
    for i in 0..6 {
        let stamina_addr = savemap + 0x0EE8 + (i * 2) as u32;
        chocobo_stamina[i] = read_memory_short(stamina_addr)?;
    }
    
    // Read chocobo target battle counts (2 bytes each) - stored at specific addresses
    let mut chocobo_target_battle_counts = [0u16; 6];
    let target_battle_count_offsets = [0x0D01, 0x0D08, 0x0D0A, 0x0D0C, 0x0D0E, 0x0D10];
    for i in 0..6 {
        let target_battle_count_addr = savemap + target_battle_count_offsets[i];
        chocobo_target_battle_counts[i] = read_memory_short(target_battle_count_addr)?;
    }
    
    Ok(ChocoboData {
        fenced_chocobos,
        stables_owned,
        occupied_stables,
        stables_occupied_mask,
        cant_mate_mask,
        stable_chocobos,
        chocobo_names,
        chocobo_stamina,
        chocobo_target_battle_counts,
    })
}

pub fn write_chocobo_slot(addresses: &FF7Addresses, slot_index: usize, chocobo: &ChocoboSlot) -> Result<(), String> {
    if slot_index >= 6 {
        return Err("Invalid chocobo slot index".to_string());
    }
    
    let savemap = addresses.savemap;
    let slot_offsets = [0x0DC4, 0x0DD4, 0x0DE4, 0x0DF4, 0x1084, 0x1094];
    let base_addr = savemap + slot_offsets[slot_index];
    
    write_memory_short(base_addr + 0x0, chocobo.sprint_speed)?;
    write_memory_short(base_addr + 0x2, chocobo.max_sprint_speed)?;
    write_memory_short(base_addr + 0x4, chocobo.speed)?;
    write_memory_short(base_addr + 0x6, chocobo.max_speed)?;
    write_memory_byte(base_addr + 0x8, chocobo.acceleration)?;
    write_memory_byte(base_addr + 0x9, chocobo.cooperation)?;
    write_memory_byte(base_addr + 0xA, chocobo.intelligence)?;
    write_memory_byte(base_addr + 0xB, chocobo.personality)?;
    write_memory_byte(base_addr + 0xC, chocobo.pcount)?;
    write_memory_byte(base_addr + 0xD, chocobo.races_won)?;
    write_memory_byte(base_addr + 0xE, chocobo.sex)?;
    write_memory_byte(base_addr + 0xF, chocobo.color)?;
    write_memory_byte(savemap + 0xE3E + slot_index as u32, chocobo.rating)?;
    
    Ok(())
}

pub fn write_fenced_chocobo(addresses: &FF7Addresses, slot_index: usize, rating: u8) -> Result<(), String> {
    if slot_index >= 4 {
        return Err("Invalid fenced chocobo slot index".to_string());
    }
    
    let savemap = addresses.savemap;
    write_memory_byte(savemap + 0x0BF9 + slot_index as u32, rating)?;
    
    Ok(())
}

pub fn write_stable_occupation_mask(addresses: &FF7Addresses, mask: u8) -> Result<(), String> {
    let savemap = addresses.savemap;
    write_memory_byte(savemap + 0x0CFF, mask)?;
    Ok(())
}

pub fn write_chocobo_name(addresses: &FF7Addresses, slot_index: usize, encoded_name: Vec<u8>) -> Result<(), String> {
    if slot_index >= 6 {
        return Err("Invalid chocobo slot index".to_string());
    }
    
    if encoded_name.len() > 6 {
        return Err("Encoded name too long (max 6 bytes)".to_string());
    }
    
    let savemap = addresses.savemap;
    let name_addr = savemap + 0x0EC4 + (slot_index as u32 * 6);
    
    // Pad to exactly 6 bytes if needed
    let mut name_data = encoded_name;
    while name_data.len() < 6 {
        name_data.push(0xFF); // FF7 string terminator
    }
    name_data.truncate(6);
    
    write_memory_buffer(name_addr, name_data)?;
    Ok(())
}

pub fn write_chocobo_stamina(addresses: &FF7Addresses, slot_index: usize, stamina: u16) -> Result<(), String> {
    if slot_index >= 6 {
        return Err("Invalid chocobo slot index".to_string());
    }
    
    let savemap = addresses.savemap;
    let stamina_addr = savemap + 0x0EE8 + (slot_index as u32 * 2);
    
    write_memory_short(stamina_addr, stamina)?;
    Ok(())
}

pub fn write_chocobo_target_battle_count(addresses: &FF7Addresses, slot_index: usize, target_battle_count: u16) -> Result<(), String> {
    if slot_index >= 6 {
        return Err("Invalid chocobo slot index".to_string());
    }
    
    let savemap = addresses.savemap;
    let target_battle_count_offsets = [0x0D01, 0x0D08, 0x0D0A, 0x0D0C, 0x0D0E, 0x0D10];
    let target_battle_count_addr = savemap + target_battle_count_offsets[slot_index];

    write_memory_short(target_battle_count_addr, target_battle_count)?;
    Ok(())
}

pub fn write_stables_owned(addresses: &FF7Addresses, count: u8) -> Result<(), String> {
    let savemap = addresses.savemap;
    write_memory_byte(savemap + 0x0CFC, count)?;
    Ok(())
}

pub fn write_occupied_stables(addresses: &FF7Addresses, count: u8) -> Result<(), String> {
    let savemap = addresses.savemap;
    write_memory_byte(savemap + 0x0CFD, count)?;
    Ok(())
}

pub fn read_current_battle_count(addresses: &FF7Addresses) -> Result<u16, String> {
    read_memory_short(addresses.battle_count)
}

pub fn set_chocobo_can_mate(addresses: &FF7Addresses, slot_index: usize, can_mate: bool) -> Result<(), String> {
    if slot_index >= 6 {
        return Err("Invalid chocobo slot index".to_string());
    }
    
    // Read current cant_mate_mask
    let savemap = addresses.savemap;
    let mut cant_mate_mask = read_memory_byte(savemap + 0x0D00)?;
    
    // Get current battle count
    let current_battle_count = read_current_battle_count(addresses)?;
    
    if can_mate {
        // Clear the cant_mate bit
        cant_mate_mask &= !(1 << slot_index);
        // Set target battle count to current battle count (can mate immediately)
        write_chocobo_target_battle_count(addresses, slot_index, current_battle_count)?;
    } else {
        // Set the cant_mate bit
        cant_mate_mask |= 1 << slot_index;
        // Set target battle count to current + 1 (can't mate until next battle)
        write_chocobo_target_battle_count(addresses, slot_index, current_battle_count + 1)?;
    }
    
    // Write updated cant_mate_mask
    write_memory_byte(savemap + 0x0D00, cant_mate_mask)?;
    
    Ok(())
}