use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct Light {
    pub color: [u8; 3], // RGB
    pub x: i32,
    pub y: i32,
    pub z: i32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FieldLights {
    pub global_light_color: [u8; 3], // RGB
    pub light1: Light,
    pub light2: Light,
    pub light3: Light,
}

#[derive(Serialize)]
pub struct FieldModel {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub direction: u8,
    pub triangle: u16,
    pub collision: u8,
    pub interaction: u8,
    pub visible: u8,
    pub collision_range: u16,
    pub talk_range: u16,
    pub lights: FieldLights,
}

#[derive(Serialize)]
pub struct FieldData {
    pub field_id: u16,
    pub field_name: Vec<u8>,
    pub field_model_count: u16,
    pub field_model_names: Vec<String>,
}

#[derive(Serialize)]
pub struct FieldLineObj {
    pub x1: i16,
    pub y1: i16,
    pub z1: i16,
    pub x2: i16,
    pub y2: i16,
    pub z2: i16,
    pub enabled: u8,
    pub entity: u8,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EncounterPair {
    pub encounter_id: u16, // 0..1023 (10 bits)
    pub rate: u8,          // 0..63 (6 bits)
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FieldEncounterSet {
    pub active: bool,
    pub encounter_rate: u8, // 0..255
    pub normal_encounters: Vec<EncounterPair>, // length 6
    pub back_attacks: Vec<EncounterPair>,      // length 2
    pub side_attack: EncounterPair,            // length 1
    pub pincer_attack: EncounterPair,          // length 1
}

#[derive(Serialize)]
pub struct FieldEncounterTables {
    pub table1: FieldEncounterSet,
    pub table2: FieldEncounterSet,
}