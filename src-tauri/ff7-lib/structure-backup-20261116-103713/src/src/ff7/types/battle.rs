use super::items::Item;
use super::kernel::Elemental;
use serde::Serialize;

#[derive(Serialize)]
pub struct BattleCharObj {
    pub index: u8,
    pub name: String,
    pub flags: u8,
    pub status: u32,
    pub hp: u32,
    pub max_hp: u32,
    pub mp: u16,
    pub max_mp: u16,
    pub atb: u16,
    pub limit: u16,
    pub scene_id: u8,
}

#[derive(Serialize)]
pub struct EnemyData {
    pub level: u8,
    pub speed: u8,
    pub luck: u8,
    pub evade: u8,
    pub strength: u8,
    pub defense: u16,
    pub magic: u8,
    pub magic_defense: u16,
    pub elements: Vec<Elemental>,
    pub items: Vec<Item>,
    pub status_immunities: u32,
    pub gil: u32,
    pub exp: u32,
    pub ap: u16,
    pub back_damage_multiplier: u8,
    pub morph: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct SceneCameraPosition {
    pub x_pos: i16,
    pub y_pos: i16,
    pub z_pos: i16,
    pub x_dir: i16,
    pub y_dir: i16,
    pub z_dir: i16,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct SceneBattleSetup {
    pub battle_location: u16,
    pub next_formation_id_on_win: u16,
    pub escape_counter: u16,
    pub next_battle_arena_candidates: [u16; 4],
    pub flags: u16, // Includes escapable flag
    pub battle_layout_type: u8,
    pub pre_battle_camera_pos_index: u8,
}

#[derive(Debug, Clone, Copy, Serialize)] 
pub struct SceneCameraPlacement {
    pub primary_idle_camera: SceneCameraPosition,
    pub other_camera_positions: [SceneCameraPosition; 2],
}

#[derive(Debug, Clone, Serialize)]
pub struct SceneBattleFormationEntry {
    pub enemy_id: u16,
    pub pos_x: i16,
    pub pos_y: i16,
    pub pos_z: i16,
    pub row: u16,
    pub cover_flags: u16,
    pub initial_condition_flags: u32,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct SceneElementRate {
    pub element_type: u8,
    pub rate: u8,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct SceneEnemyItem {
    pub rate: u8, // Combined drop/steal rate byte
    pub item_id: u16,
}

#[derive(Debug, Clone, Serialize)]
pub struct SceneEnemy {
    pub id: u16,
    pub name: String, // Decoded name
    pub level: u8,
    pub speed: u8,
    pub luck: u8,
    pub evade: u8,
    pub strength: u8,
    pub defense: u8,
    pub magic: u8,
    pub magic_defense: u8,
    pub element_rates: [SceneElementRate; 8],
    pub enemy_attack_ids: [u16; 16],
    pub enemy_attack_camera_movement_ids: [u16; 16],
    pub items: [SceneEnemyItem; 4],
    pub manipulated_berserk_attack_indexes: [u16; 3],
    pub mp: u16,
    pub ap: u16,
    pub morph_item_id: u16,
    pub back_damage_multiplier: u8,
    pub hp: u32,
    pub exp: u32,
    pub gil: u32,
    pub status_immunities: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct SceneAttack {
    pub id: u16,
    pub name: String, // Decoded name
}

// --- Stubbed Structures ---

// #[derive(Debug, Clone, Copy, Serialize)]
// pub struct SceneAttackData {
//     pub data: [u8; 28],
// }

// #[derive(Debug, Clone, Copy, Serialize)]
// pub struct SceneAIHeader {
//     pub script_offsets: [u16; 16],
// }

// #[derive(Debug, Clone, Serialize)]
// pub struct SceneAIData {
//     pub data: Vec<u8>,
// }

#[derive(Debug, Clone, Serialize)]
pub struct SceneFormation {
    pub setup: SceneBattleSetup,
    pub camera_placement: SceneCameraPlacement,
    pub enemies: Vec<SceneBattleFormationEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Scene {
    pub enemies: [SceneEnemy; 3],
    pub formations: [SceneFormation; 4],
    // pub attack_data: [SceneAttackData; 32],
    pub attacks: Vec<SceneAttack>,
    // pub formation_ai_script_offsets: [u16; 4],
    // pub formation_ai_data: SceneAIData,
    // pub enemy_ai_script_offsets: [u16; 3],
    // pub enemy_ai_headers: [SceneAIHeader; 3],
    // pub enemy_ai_data: SceneAIData,
}