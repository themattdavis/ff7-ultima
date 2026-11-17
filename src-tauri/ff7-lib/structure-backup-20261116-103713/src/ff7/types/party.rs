use serde::Serialize;

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
pub struct MateriaSlot {
  pub id: u8,
  pub ap: u32, // Representing u24 as u32
}

#[derive(Serialize)]
pub struct PartyMember {
  pub id: u8,
  pub name: String,
  pub level: u8,
  pub strength: u8,
  pub vitality: u8,
  pub magic: u8,
  pub spirit: u8,
  pub dexterity: u8,
  pub luck: u8,
  pub strength_bonus: u8,
  pub vitality_bonus: u8,
  pub magic_bonus: u8,
  pub spirit_bonus: u8,
  pub dexterity_bonus: u8,
  pub luck_bonus: u8,
  pub limit_level: u8,
  pub status: u8,
  pub order: u8,
  pub hp: u16,
  pub base_hp: u16,
  pub max_hp: u16,
  pub mp: u16,
  pub base_mp: u16,
  pub max_mp: u16,
  pub limit: u8,
  pub exp: u32,
  pub weapon: u8,
  pub armor: u8,
  pub accessory: u8,
  pub limit_skills: u16,
  pub kills: u16,
  pub limit_1_1_uses: u16,
  pub limit_2_1_uses: u16,
  pub limit_3_1_uses: u16,
  pub weapon_materia: Vec<MateriaSlot>,
  pub armor_materia: Vec<MateriaSlot>,
  pub exp_to_next_level: u32,
}