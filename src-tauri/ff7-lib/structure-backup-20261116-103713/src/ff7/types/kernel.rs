use serde::Serialize;

#[derive(Serialize)]
pub struct Elemental {
    pub element: u8,
    pub effect: u8,
}

#[allow(dead_code)]
#[derive(Serialize)]
pub enum ElementalEffect {
    Death = 0,
    DoubleDamage = 2,
    HalfDamage = 4,
    Nullify = 5,
    Absorb = 6,
    FullCure = 7,
    Nothing = 0xFF,
}

#[allow(dead_code)]
#[derive(Serialize)]
pub enum ElementalType {
    Fire = 0,
    Ice,
    Bolt,
    Earth,
    Bio,
    Gravity,
    Water,
    Wind,
    Holy,
    Health,
    Cut,
    Hit,
    Punch,
    Shoot,
    Scream,
    Hidden,
    Nothing = 0xFF,
}

#[derive(Serialize)]
pub struct ItemData {
    pub camera_move_id: u16,
    pub restriction_mask: u16,
    pub target_flags: u8,
    pub attack_effect_id: u8,
    pub damage_func: u8,
    pub power: u8,
    pub condition: u8,
    pub status_effect_change: u8,
    pub attack_additional_effect: u8,
    pub additional_effect_modifier: u8,
    pub status_effects: u32,
    pub attack_element: u16,
    pub special_attack_flags: u16,
}