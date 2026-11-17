use crate::ff7::addresses::FF7Addresses;
use crate::ff7::types::party::{PartyMember, MateriaSlot};
use crate::ff7::data::kernel::read_name;
use crate::utils::memory::*;

fn read_materia_slot(addr: u32) -> Result<MateriaSlot, String> {
  let val = read_memory_int(addr)?;
  if val == 0xFFFFFFFF { 
    return Ok(MateriaSlot { id: 0xFF, ap: 0 });
  }
  let id = (val & 0xFF) as u8;
  let ap = (val >> 8) & 0xFFFFFF; // Extract 24 bits for AP
  Ok(MateriaSlot { id, ap })
}

pub fn read_party_members(addresses: &FF7Addresses) -> Result<Vec<PartyMember>, String> {
  let mut party_members = Vec::new();
  const CHAR_RECORD_LENGTH: u32 = 0x84;
  for i in 0..9 {
    let base_addr = addresses.character_records + i as u32 * CHAR_RECORD_LENGTH;
    let name_addr = base_addr + 0x10;
    let decoded_name = read_name(name_addr, 15)?;
    
    let mut weapon_materia = Vec::with_capacity(8);
    for j in 0..8 {
      weapon_materia.push(read_materia_slot(base_addr + 0x40 + (j * 4))?);
    }

    let mut armor_materia = Vec::with_capacity(8);
    for j in 0..8 {
      armor_materia.push(read_materia_slot(base_addr + 0x60 + (j * 4))?);
    }
    
    party_members.push(PartyMember { 
      id: read_memory_byte(base_addr)?, 
      name: decoded_name,
      level: read_memory_byte(base_addr + 0x01)?,
      strength: read_memory_byte(base_addr + 0x02)?,
      vitality: read_memory_byte(base_addr + 0x03)?,
      magic: read_memory_byte(base_addr + 0x04)?,
      spirit: read_memory_byte(base_addr + 0x05)?,
      dexterity: read_memory_byte(base_addr + 0x06)?,
      luck: read_memory_byte(base_addr + 0x07)?,
      strength_bonus: read_memory_byte(base_addr + 0x08)?,
      vitality_bonus: read_memory_byte(base_addr + 0x09)?,
      magic_bonus: read_memory_byte(base_addr + 0x0A)?,
      spirit_bonus: read_memory_byte(base_addr + 0x0B)?,
      dexterity_bonus: read_memory_byte(base_addr + 0x0C)?,
      luck_bonus: read_memory_byte(base_addr + 0x0D)?,
      limit_level: read_memory_byte(base_addr + 0x0E)?,
      status: read_memory_byte(base_addr + 0x1f)?,
      order: read_memory_byte(base_addr + 0x20)?,
      hp: read_memory_short(base_addr + 0x2c)?,
      base_hp: read_memory_short(base_addr + 0x2e)?,
      max_hp: read_memory_short(base_addr + 0x38)?,
      mp: read_memory_short(base_addr + 0x30)?,
      base_mp: read_memory_short(base_addr + 0x32)?,
      max_mp: read_memory_short(base_addr + 0x3a)?,
      limit: read_memory_byte(base_addr + 0xf)?,
      exp: read_memory_int(base_addr + 0x3c)?,
      weapon: read_memory_byte(base_addr + 0x1C)?,
      armor: read_memory_byte(base_addr + 0x1D)?,
      accessory: read_memory_byte(base_addr + 0x1E)?,
      limit_skills: read_memory_short(base_addr + 0x22)?,
      kills: read_memory_short(base_addr + 0x24)?,
      limit_1_1_uses: read_memory_short(base_addr + 0x26)?,
      limit_2_1_uses: read_memory_short(base_addr + 0x28)?,
      limit_3_1_uses: read_memory_short(base_addr + 0x2A)?,
      weapon_materia,
      armor_materia,
      exp_to_next_level: read_memory_int(base_addr + 0x80)?,
    });
  }

  Ok(party_members)
}