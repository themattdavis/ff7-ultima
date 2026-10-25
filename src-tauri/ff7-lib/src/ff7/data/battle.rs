use crate::ff7::addresses::FF7Addresses;
use crate::ff7::data::kernel::read_name;
use crate::ff7::types::battle::*;
use crate::ff7::types::items::{Item, ItemType};
use crate::ff7::types::kernel::Elemental;
use crate::utils::memory::*;
use crate::utils::process;
use byteorder::{ReadBytesExt, LittleEndian};
use std::fs;
use std::io::{Read, Cursor, Seek, SeekFrom};
use std::path::Path;
use flate2::read::GzDecoder;
use crate::ff7::ff7text::decode_text; // Needed for names

pub fn read_battle_allies(addresses: &FF7Addresses) -> Result<Vec<BattleCharObj>, String> {
    let mut party_ids = Vec::new();
    for i in 0..3 {
        party_ids.push(read_memory_byte(addresses.party_member_ids + i)?);
    }

    let mut party_names = Vec::new();
    for i in 0..3 {
        let name_addr = addresses.party_member_names + party_ids[i as usize] as u32 * 0x84;
        let decoded_name = read_name(name_addr, 15);
        party_names.push(decoded_name.unwrap_or_else(|_| String::from("???")));
    }

    let mut chars: Vec<BattleCharObj> = Vec::new();
    let char_obj_length = 104;
    for i in 0..3 {
        let name = party_names[i as usize].clone();
        let char = BattleCharObj {
            index: i as u8,
            name,
            status: read_memory_int(addresses.battle_char_base + i * char_obj_length)?,
            flags: read_memory_byte(addresses.battle_char_base + i * char_obj_length + 0x5)?,
            hp: read_memory_int(addresses.battle_char_base + i * char_obj_length + 0x2c)?,
            max_hp: read_memory_int(addresses.battle_char_base + i * char_obj_length + 0x30)?,
            mp: read_memory_short(addresses.battle_char_base + i * char_obj_length + 0x28)?,
            max_mp: read_memory_short(addresses.battle_char_base + i * char_obj_length + 0x2a)?,
            atb: read_memory_short(addresses.battle_atb_base + i * 68 + 0x2)?,
            limit: read_memory_short(addresses.battle_char_array + i * 0x34 + 0x8)?,
            scene_id: 0,
        };
        chars.push(char);
    }
    Ok(chars)
}

pub fn read_battle_enemies(addresses: &FF7Addresses) -> Result<Vec<BattleCharObj>, String> {
    let mut chars: Vec<BattleCharObj> = Vec::new();
    let char_obj_length = 104;
    let enemy_record_length = 16;
    let enemy_data_length = 184;
    for i in 4..10 {
        let enemy_scene_idx =
            read_memory_byte(addresses.enemy_obj_base + (i - 4) * enemy_record_length).unwrap_or(0);
        let enemy_name =
            read_name(addresses.enemy_data_base + u32::from(enemy_scene_idx) * enemy_data_length, 24);

        let char = BattleCharObj {
            index: i as u8,
            name: enemy_name.unwrap_or_else(|_| String::from("???")),
            status: read_memory_int(addresses.battle_char_base + i * char_obj_length)?,
            flags: read_memory_byte(addresses.battle_char_base + i * char_obj_length + 0x5)?,
            hp: read_memory_int(addresses.battle_char_base + i * char_obj_length + 0x2c)?,
            max_hp: read_memory_int(addresses.battle_char_base + i * char_obj_length + 0x30)?,
            mp: read_memory_short(addresses.battle_char_base + i * char_obj_length + 0x28)?,
            max_mp: read_memory_short(addresses.battle_char_base + i * char_obj_length + 0x2a)?,
            atb: read_memory_short(addresses.battle_atb_base + i * 68 + 0x2)?,
            limit: 0,
            scene_id: enemy_scene_idx,
        };
        chars.push(char);
    }
    Ok(chars)
}

pub fn read_enemy_data(id: u32) -> Result<EnemyData, String> {
    let addresses = FF7Addresses::new();
    let enemy_data_length = 184;
    let enemy_data_addr = addresses.enemy_data_base + id * enemy_data_length;

    let level = read_memory_byte(enemy_data_addr + 0x20)? as u8;
    let speed = read_memory_byte(enemy_data_addr + 0x21)? as u8;
    let luck = read_memory_byte(enemy_data_addr + 0x22)? as u8;
    let evade = read_memory_byte(enemy_data_addr + 0x23)? as u8;
    let strength = read_memory_byte(enemy_data_addr + 0x24)? as u8;
    let magic = read_memory_byte(enemy_data_addr + 0x26)? as u8;

    // Defense and magic defense are multiplied by 2 to get the actual value that the game uses
    let defense = read_memory_byte(enemy_data_addr + 0x25)? as u16 * 2;
    let magic_defense = read_memory_byte(enemy_data_addr + 0x27)? as u16 * 2;

    let gil = read_memory_int(enemy_data_addr + 0xAC)?;
    let exp = read_memory_int(enemy_data_addr + 0xA8)?;
    let ap = read_memory_short(enemy_data_addr + 0x9E)?;
    let back_damage_multiplier = read_memory_byte(enemy_data_addr + 0xA2)? / 8;

    let mut elements: Vec<Elemental> = Vec::new();
    for i in 0..8 {
        let element = read_memory_byte(enemy_data_addr + 0x28 + i)?;
        elements.push(Elemental {
            element,
            effect: read_memory_byte(enemy_data_addr + 0x30 + i)?,
        });
    }

    let status_immunities: u32 = read_memory_int(enemy_data_addr + 0xb0)?;

    let item_names = crate::ff7::data::kernel::read_item_names(&addresses)?;
    let mut items: Vec<Item> = Vec::new();
    for i in 0..4 {
        let rate = read_memory_byte(enemy_data_addr + 0x88 + i)? as u8;
        let id = read_memory_short(enemy_data_addr + 0x8c + i * 2)? as u32;

        if id == 0xFFFF {
            break;
        }

        let name = item_names[id as usize].clone();

        // Type is Drop when rate is lower than 128
        let item_type = if rate < 128 {
            ItemType::Drop
        } else {
            ItemType::Steal
        };

        items.push(Item {
            rate: rate % 128,
            name,
            item_type,
        });
    }

    let morph_id = read_memory_short(enemy_data_addr + 0xA0)? as u16;
    let morph = if morph_id == 0xFFFF {
        None
    } else {
        Some(item_names[morph_id as usize].clone())
    };

    // Match the field order from src/ff7/types/battle.rs definition
    Ok(EnemyData {
        level,
        speed,
        luck,
        evade,
        strength,
        defense, // u16
        magic,
        magic_defense, // u16
        elements,
        items, // Vec<Item>
        status_immunities,
        gil,
        exp,
        ap,
        back_damage_multiplier,
        morph, // Option<String>
    })
}

pub fn read_enemy_attack_names(addresses: &FF7Addresses) -> Result<Vec<String>, String> {
    let mut attack_names: Vec<String> = Vec::new();
    for i in 0..32 {
        let check = read_memory_byte(addresses.enemy_attack_names + i * 32)?;
        if check != 0xFF {
            let name = read_name(addresses.enemy_attack_names + i * 32, 32);
            attack_names.push(name.unwrap_or_else(|_| String::from("???")));
        } else {
            attack_names.push(String::from(""));
        }
    }
    Ok(attack_names)
}

const BLOCK_HEADER_COUNT: usize = 16;
const SCENE_SIZE: usize = 0x2000; // 8192

/// Reads and parses the main scene.bin file from the game directory.
pub fn read_scene_bin() -> Result<Vec<Scene>, String> {
    let game_dir = process::get_current_dir()
        .ok_or_else(|| "Failed to get current game directory".to_string())?;
    let scene_bin_path = Path::new(&game_dir).join("data/lang-en/battle/scene.bin");

    read_scene_bin_from_path(&scene_bin_path)
}

pub fn read_scene_bin_from_path(scene_bin_path: &Path) -> Result<Vec<Scene>, String> {
    let data = fs::read(scene_bin_path)
        .map_err(|e| format!("Failed to read scene.bin: {}", e))?;

    let mut decompressed_scenes: Vec<Vec<u8>> = Vec::new();
    let mut pos: usize = 0;
    let mut block: usize = 0;
    let data_len = data.len();

    while pos < data_len {
        let block_start_pos = block * SCENE_SIZE;
        if block_start_pos >= data_len {
            break; // Ensure we don't read past the end of the file for the block start
        }

        let mut header_cursor = Cursor::new(&data[block_start_pos..std::cmp::min(block_start_pos + BLOCK_HEADER_COUNT * 4, data_len)]);
        let mut scene_offsets: Vec<usize> = Vec::new();

        for _ in 0..BLOCK_HEADER_COUNT {
            if header_cursor.position() >= header_cursor.get_ref().len() as u64 {
                break; // Stop if we reach the end of the header data prematurely
            }
            let mut buf = [0u8; 4];
            match header_cursor.read_exact(&mut buf) {
                Ok(_) => {
                    let block_header = u32::from_le_bytes(buf);
                    if block_header != 0xFFFFFFFF {
                        scene_offsets.push((block_header * 4) as usize);
                        pos += 4; // Increment overall position tracker based on header reads
                    } else {
                        break; // End of headers for this block
                    }
                }
                Err(_) => break, // Error reading header, stop processing this block
            }
        }

        if scene_offsets.is_empty() {
             // If no valid offsets were found, but we haven't reached EOF, move to the next potential block
             // This handles cases where a block might be empty or corrupted but not the last one.
             if block_start_pos + SCENE_SIZE < data_len {
                 block += 1;
                 pos = block * SCENE_SIZE; // Reset pos to the start of the next block
                 continue;
             } else {
                 break; // Reached end of file or last block was empty/corrupt
             }
        }


        for (index, &scene_offset) in scene_offsets.iter().enumerate() {
            let current_scene_start = block_start_pos + scene_offset;

            // Determine the end of the current scene's compressed data
            let next_scene_start_offset = if index < scene_offsets.len() - 1 {
                scene_offsets[index + 1]
            } else {
                // If it's the last scene in the block, its size extends to the start of the next block
                // or the end of the file, whichever comes first.
                // However, the original logic implies size is calculated relative to the *next* offset
                // or the *total data length*. Let's refine this.
                // We need the size relative to the *current* block's potential end or data end.
                // A simpler way might be to just read until the next offset or block boundary.
                 // Calculate size based on next offset or end of *data* if last scene overall
                 let end_boundary = if block_start_pos + SCENE_SIZE < data_len {
                    block_start_pos + SCENE_SIZE // End of current block if not the last block
                 } else {
                    data_len // End of file if it's the last block
                 };
                 // The size is the difference between the next scene's start or the boundary, and the current scene's start.
                 if index < scene_offsets.len() - 1 {
                     scene_offsets[index + 1]
                 } else {
                     // For the last scene, its data runs until the end of the block or EOF
                     end_boundary - block_start_pos // Offset relative to block start
                 }
            };

            let scene_size = next_scene_start_offset - scene_offset;


            if current_scene_start + scene_size > data_len {
                log::warn!(target: "backend", "Scene data range exceeds file bounds for block {}, scene index {}. Skipping.", block, index);
                continue; // Skip this scene if its calculated range is invalid
            }

            let compressed_scene_data = &data[current_scene_start..current_scene_start + scene_size];

            // Gzip decompression
            let mut decoder = GzDecoder::new(compressed_scene_data);
            let mut decompressed_data = Vec::new();
            if let Err(e) = decoder.read_to_end(&mut decompressed_data) {
                 // Check for specific error: Gzip header mismatch (often indicates not Gzipped)
                 // The error kind might be io::ErrorKind::InvalidData
                 if e.kind() == std::io::ErrorKind::InvalidData && e.to_string().contains("invalid gzip header") {
                    log::warn!(target: "backend", "Skipping scene (block {}, index {}): Not valid Gzip data.", block, index);
                 } else if e.kind() == std::io::ErrorKind::UnexpectedEof {
                     log::warn!(target: "backend", "Skipping scene (block {}, index {}): Unexpected EOF during Gzip decompression. Data might be truncated or corrupt. Error: {}", block, index, e);
                 }
                 else {
                    log::error!(target: "backend", "Failed to decompress scene (block {}, index {}): {}. Skipping.", block, index, e);
                 }
                continue; // Skip this scene on decompression error
            }

            if !decompressed_data.is_empty() {
                decompressed_scenes.push(decompressed_data);
            } else {
                 log::warn!(target: "backend", "Decompressed scene (block {}, index {}) resulted in empty data. Original size: {}", block, index, compressed_scene_data.len());
            }
        }

        // Move to the next block
        block += 1;
        pos = block * SCENE_SIZE; // Set position for the start of the next block
                                  // The loop condition `pos < data_len` will handle termination
    }

    log::info!(target: "backend", "Successfully decompressed {} scenes from scene.bin", decompressed_scenes.len());
    let mut scenes: Vec<Scene> = Vec::new();
    for (i, scene_data) in decompressed_scenes.iter().enumerate() {
        match parse_scene_data(scene_data) {
            Ok(scene) => scenes.push(scene),
            Err(e) => log::error!(target: "backend", "Failed to parse scene index {}: {}", i, e),
        }
    }

    log::info!(target: "backend", "Successfully parsed {} scenes from scene.bin", scenes.len());
    Ok(scenes) // Return the parsed scenes
}

fn read_string_from_bytes(bytes: &[u8]) -> String {
    // Find the first occurrence of 0xFF, which terminates the string
    let end = bytes.iter().position(|&b| b == 0xFF).unwrap_or(bytes.len());
    decode_text(&bytes[..end]).unwrap_or_else(|_| "Decode Error".to_string())
}

fn parse_camera_position(cursor: &mut Cursor<&[u8]>) -> Result<SceneCameraPosition, String> {
    Ok(SceneCameraPosition {
        x_pos: cursor.read_i16::<LittleEndian>().map_err(|e| e.to_string())?,
        y_pos: cursor.read_i16::<LittleEndian>().map_err(|e| e.to_string())?,
        z_pos: cursor.read_i16::<LittleEndian>().map_err(|e| e.to_string())?,
        x_dir: cursor.read_i16::<LittleEndian>().map_err(|e| e.to_string())?,
        y_dir: cursor.read_i16::<LittleEndian>().map_err(|e| e.to_string())?,
        z_dir: cursor.read_i16::<LittleEndian>().map_err(|e| e.to_string())?,
    })
}

fn parse_battle_setup(cursor: &mut Cursor<&[u8]>) -> Result<SceneBattleSetup, String> {
    let battle_location = cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?;
    let next_formation_id_on_win = cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?;
    let escape_counter = cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?;
    let _unused_align_ff = cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?;
    let mut next_battle_arena_candidates = [0u16; 4];
    cursor.read_u16_into::<LittleEndian>(&mut next_battle_arena_candidates).map_err(|e| e.to_string())?;
    let flags = cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?;
    let battle_layout_type = cursor.read_u8().map_err(|e| e.to_string())?;
    let pre_battle_camera_pos_index = cursor.read_u8().map_err(|e| e.to_string())?;
    Ok(SceneBattleSetup {
        battle_location,
        next_formation_id_on_win,
        escape_counter,
        next_battle_arena_candidates,
        flags,
        battle_layout_type,
        pre_battle_camera_pos_index,
    })
}

fn parse_camera_placement(cursor: &mut Cursor<&[u8]>) -> Result<SceneCameraPlacement, String> {
    let primary_idle_camera = parse_camera_position(cursor)?;
    let mut other_camera_positions = [
        SceneCameraPosition { x_pos: 0, y_pos: 0, z_pos: 0, x_dir: 0, y_dir: 0, z_dir: 0 },
        SceneCameraPosition { x_pos: 0, y_pos: 0, z_pos: 0, x_dir: 0, y_dir: 0, z_dir: 0 },
    ];
    for i in 0..2 {
        other_camera_positions[i] = parse_camera_position(cursor)?;
    }
    let mut _unused_align_ff = [0u8; 12];
    cursor.read_exact(&mut _unused_align_ff).map_err(|e| e.to_string())?;
    Ok(SceneCameraPlacement {
        primary_idle_camera,
        other_camera_positions,
    })
}

fn parse_battle_formation_entry(cursor: &mut Cursor<&[u8]>) -> Result<SceneBattleFormationEntry, String> {
    Ok(SceneBattleFormationEntry {
        enemy_id: cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?,
        pos_x: cursor.read_i16::<LittleEndian>().map_err(|e| e.to_string())?,
        pos_y: cursor.read_i16::<LittleEndian>().map_err(|e| e.to_string())?,
        pos_z: cursor.read_i16::<LittleEndian>().map_err(|e| e.to_string())?,
        row: cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?,
        cover_flags: cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?,
        initial_condition_flags: cursor.read_u32::<LittleEndian>().map_err(|e| e.to_string())?,
    })
}

fn parse_enemy_data(cursor: &mut Cursor<&[u8]>, enemy_id: u16) -> Result<SceneEnemy, String> {
    let mut name_bytes = [0u8; 32];
    cursor.read_exact(&mut name_bytes).map_err(|e| e.to_string())?;
    let name = read_string_from_bytes(&name_bytes);

    let level = cursor.read_u8().map_err(|e| e.to_string())?;
    let speed = cursor.read_u8().map_err(|e| e.to_string())?;
    let luck = cursor.read_u8().map_err(|e| e.to_string())?;
    let evade = cursor.read_u8().map_err(|e| e.to_string())?;
    let strength = cursor.read_u8().map_err(|e| e.to_string())?;
    let defense = cursor.read_u8().map_err(|e| e.to_string())?;
    let magic = cursor.read_u8().map_err(|e| e.to_string())?;
    let magic_defense = cursor.read_u8().map_err(|e| e.to_string())?;

    let mut element_types = [0u8; 8];
    cursor.read_exact(&mut element_types).map_err(|e| e.to_string())?;
    let mut element_effect_rates = [0u8; 8];
    cursor.read_exact(&mut element_effect_rates).map_err(|e| e.to_string())?;
    let element_rates = std::array::from_fn(|i| SceneElementRate {
        element_type: element_types[i],
        rate: element_effect_rates[i],
    });

    let mut _action_animation_index = [0u8; 16];
    cursor.read_exact(&mut _action_animation_index).map_err(|e| e.to_string())?;

    let mut enemy_attack_ids = [0u16; 16];
    cursor.read_u16_into::<LittleEndian>(&mut enemy_attack_ids).map_err(|e| e.to_string())?;

    let mut enemy_attack_camera_movement_ids = [0u16; 16];
    cursor.read_u16_into::<LittleEndian>(&mut enemy_attack_camera_movement_ids).map_err(|e| e.to_string())?;

    let mut item_rates = [0u8; 4];
    cursor.read_exact(&mut item_rates).map_err(|e| e.to_string())?;
    let mut item_ids = [0u16; 4];
    cursor.read_u16_into::<LittleEndian>(&mut item_ids).map_err(|e| e.to_string())?;
    let items = std::array::from_fn(|i| SceneEnemyItem {
        rate: item_rates[i],
        item_id: item_ids[i],
    });

    let mut manipulated_berserk_attack_indexes = [0u16; 3];
    cursor.read_u16_into::<LittleEndian>(&mut manipulated_berserk_attack_indexes).map_err(|e| e.to_string())?;

    let _unknown_9a = cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?;
    let mp = cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?;
    let ap = cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?;
    let morph_item_id = cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?;
    let back_damage_multiplier = cursor.read_u8().map_err(|e| e.to_string())?;
    let _align_a3 = cursor.read_u8().map_err(|e| e.to_string())?;
    let hp = cursor.read_u32::<LittleEndian>().map_err(|e| e.to_string())?;
    let exp = cursor.read_u32::<LittleEndian>().map_err(|e| e.to_string())?;
    let gil = cursor.read_u32::<LittleEndian>().map_err(|e| e.to_string())?;
    let status_immunities = cursor.read_u32::<LittleEndian>().map_err(|e| e.to_string())?;
    let _unknown_b4 = cursor.read_u32::<LittleEndian>().map_err(|e| e.to_string())?;

    Ok(SceneEnemy {
        id: enemy_id,
        name,
        level,
        speed,
        luck,
        evade,
        strength,
        defense,
        magic,
        magic_defense,
        element_rates,
        enemy_attack_ids,
        enemy_attack_camera_movement_ids,
        items,
        manipulated_berserk_attack_indexes,
        mp,
        ap,
        morph_item_id,
        back_damage_multiplier,
        hp,
        exp,
        gil,
        status_immunities,
    })
}

fn parse_attack(cursor: &mut Cursor<&[u8]>, attack_id: u16) -> Result<SceneAttack, String> {
    let mut raw_name = [0u8; 32];
    cursor.read_exact(&mut raw_name).map_err(|e| e.to_string())?;
    let name = read_string_from_bytes(&raw_name);
    Ok(SceneAttack { id: attack_id, name })
}

fn parse_scene_data(data: &[u8]) -> Result<Scene, String> {
    let mut cursor = Cursor::new(data);

    let enemy_id_1 = cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?;
    let enemy_id_2 = cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?;
    let enemy_id_3 = cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?;
    let _padding_ffff = cursor.read_u16::<LittleEndian>().map_err(|e| e.to_string())?;

    let mut formations: [SceneFormation; 4] = std::array::from_fn(|_| SceneFormation {
        setup: SceneBattleSetup { 
            battle_location: 0, 
            next_formation_id_on_win: 0, 
            escape_counter: 0, 
            next_battle_arena_candidates: [0; 4], 
            flags: 0, 
            battle_layout_type: 0, 
            pre_battle_camera_pos_index: 0 
        },
        camera_placement: SceneCameraPlacement {
            primary_idle_camera: SceneCameraPosition { x_pos: 0, y_pos: 0, z_pos: 0, x_dir: 0, y_dir: 0, z_dir: 0 },
            other_camera_positions: [
                SceneCameraPosition { x_pos: 0, y_pos: 0, z_pos: 0, x_dir: 0, y_dir: 0, z_dir: 0 },
                SceneCameraPosition { x_pos: 0, y_pos: 0, z_pos: 0, x_dir: 0, y_dir: 0, z_dir: 0 },
            ],
        },
        enemies: Vec::new(),
    });

    for i in 0..4 {
        formations[i].setup = parse_battle_setup(&mut cursor)?;
    }

    for i in 0..4 {
        formations[i].camera_placement = parse_camera_placement(&mut cursor)?;
    }

    for i in 0..4 {
        for _ in 0..6 {
            let enemy = parse_battle_formation_entry(&mut cursor)?;
            if enemy.enemy_id != 0xFFFF {
                formations[i].enemies.push(enemy);
            }
        }
    }

    let mut enemies: [SceneEnemy; 3] = std::array::from_fn(|_| Default::default());
    enemies[0] = parse_enemy_data(&mut cursor, enemy_id_1)?;
    enemies[1] = parse_enemy_data(&mut cursor, enemy_id_2)?;
    enemies[2] = parse_enemy_data(&mut cursor, enemy_id_3)?;

    // Skip attack data
    cursor.seek(SeekFrom::Current(32 * 28)).map_err(|e| e.to_string())?;

    let mut attack_ids = [0u16; 32];
    cursor.read_u16_into::<LittleEndian>(&mut attack_ids).map_err(|e| e.to_string())?;

    let mut attacks = Vec::new();
    for i in 0..32 {
        if attack_ids[i] != 0xFFFF {
            attacks.push(parse_attack(&mut cursor, attack_ids[i])?);
        } else {
            // Skip the name data for empty attacks
            cursor.seek(SeekFrom::Current(32)).map_err(|e| e.to_string())?;
        }
    }

    // Skip AI data
    cursor.seek(SeekFrom::End(0)).map_err(|e| e.to_string())?;

    Ok(Scene {
        enemies,
        formations,
        attacks,
    })
}

// Implement Default for SceneEnemy
impl Default for SceneEnemy {
    fn default() -> Self {
        SceneEnemy {
            id: 0xFFFF,
            name: String::new(),
            level: 0, speed: 0, luck: 0, evade: 0, strength: 0, defense: 0, magic: 0, magic_defense: 0,
            element_rates: std::array::from_fn(|_| SceneElementRate { element_type: 0xFF, rate: 0xFF }),
            enemy_attack_ids: [0xFFFF; 16],
            enemy_attack_camera_movement_ids: [0xFFFF; 16],
            items: std::array::from_fn(|_| SceneEnemyItem { rate: 0, item_id: 0xFFFF }),
            manipulated_berserk_attack_indexes: [0xFFFF; 3],
            mp: 0, ap: 0, morph_item_id: 0xFFFF, back_damage_multiplier: 0, hp: 0, exp: 0, gil: 0, status_immunities: 0xFFFFFFFF,
        }
    }
}

impl Default for SceneBattleFormationEntry {
    fn default() -> Self {
        SceneBattleFormationEntry {
            enemy_id: 0xFFFF,
            pos_x: 0, pos_y: 0, pos_z: 0,
            row: 0, cover_flags: 0, initial_condition_flags: 0,
        }
    }
}
