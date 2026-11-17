use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChocoboSlot {
    pub sprint_speed: u16,
    pub max_sprint_speed: u16,
    pub speed: u16,
    pub max_speed: u16,
    pub acceleration: u8,
    pub cooperation: u8,
    pub intelligence: u8,
    pub personality: u8,
    pub pcount: u8,
    pub races_won: u8,
    pub rating: u8,
    pub sex: u8, // 1 = female, 0 = male
    pub color: u8, // 0=Yellow, 1=Green, 2=Blue, 3=Black, 4=Gold
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
pub struct FencedChocobo {
    pub rating: u8, // 1=Wonderful, 2=Great, 3=Good, 4=Average, 5=Poor, 6=So-So, 7=?, 8=Worst
}

#[derive(Serialize, Debug)]
pub struct ChocoboData {
    pub fenced_chocobos: [FencedChocobo; 4], // Penned chocobo ratings (4 slots)
    pub stables_owned: u8, // Number of chocobo stables owned
    pub occupied_stables: u8, // Number of occupied stables
    pub stables_occupied_mask: u8, // Bitmask for occupied stables
    pub cant_mate_mask: u8, // Bitmask for chocobos that can't mate
    pub stable_chocobos: [Option<ChocoboSlot>; 6], // 6 stable slots, some may be empty
    pub chocobo_names: [String; 6], // Names for each stable chocobo (6 bytes each in FF text format)
    pub chocobo_stamina: [u16; 6], // Stamina values for each stable chocobo
    pub chocobo_target_battle_counts: [u16; 6], // Target battle counts for mating eligibility (2 bytes each)
}