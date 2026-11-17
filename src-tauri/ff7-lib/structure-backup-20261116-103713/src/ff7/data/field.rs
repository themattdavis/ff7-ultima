use crate::ff7::addresses::FF7Addresses;
use crate::ff7::types::field::{FieldData, FieldModel, FieldLineObj, FieldLights, Light, FieldEncounterTables, FieldEncounterSet, EncounterPair};
use crate::utils::memory::*;

fn read_f32_from_memory(address: u32) -> Result<f32, String> {
    let int_val = read_memory_int(address)?;
    Ok(f32::from_bits(int_val))
}

fn convert_bgra_to_rgb(b: f32, g: f32, r: f32, _a: f32) -> [u8; 3] {
    [
        (r.clamp(0.0, 1.0) * 255.0).round() as u8,
        (g.clamp(0.0, 1.0) * 255.0).round() as u8,
        (b.clamp(0.0, 1.0) * 255.0).round() as u8,
    ]
}

fn convert_xyz_coordinates(fx: f32, fy: f32, fz: f32) -> (i32, i32, i32) {
    let x = (-fx * 4096.0).round() as i32;
    let y = (fz * 4096.0).round() as i32;
    let z = (-fy * 4096.0).round() as i32;
    (x, y, z)
}

fn read_light_definition(light_ptr: u32) -> Result<Light, String> {
    // Skip 4 bytes (always 0)
    // Skip 4 bytes (hex color - intermediate value)
    let fx = read_f32_from_memory(light_ptr + 8)?;
    let fy = read_f32_from_memory(light_ptr + 12)?;
    let fz = read_f32_from_memory(light_ptr + 16)?;
    // Read BGRA color (4 * 4 bytes)
    let color_b = read_f32_from_memory(light_ptr + 20)?;
    let color_g = read_f32_from_memory(light_ptr + 24)?;
    let color_r = read_f32_from_memory(light_ptr + 28)?;
    let color_a = read_f32_from_memory(light_ptr + 32)?;
    
    let (x, y, z) = convert_xyz_coordinates(fx, fy, fz);
    let color = convert_bgra_to_rgb(color_b, color_g, color_r, color_a);
    
    Ok(Light { 
        color,
        x, 
        y, 
        z 
    })
}

fn read_field_lights(model_index: u32, addresses: &FF7Addresses) -> Result<FieldLights, String> {
    // Get the pointer to the specific model's light object
    let light_obj_ptr = read_memory_int(addresses.field_light_table + model_index * 4)?;
    if light_obj_ptr == 0 {
        return Ok(FieldLights {
            global_light_color: [0, 0, 0],
            light1: Light { color: [0, 0, 0], x: 0, y: 0, z: 0 },
            light2: Light { color: [0, 0, 0], x: 0, y: 0, z: 0 },
            light3: Light { color: [0, 0, 0], x: 0, y: 0, z: 0 },
        });
    }

    // Skip first 8 bytes (always 9, always 3)
    let light1_ptr = read_memory_int(light_obj_ptr + 8)?;
    let light2_ptr = read_memory_int(light_obj_ptr + 12)?;
    let light3_ptr = read_memory_int(light_obj_ptr + 16)?;

    // Skip 16 bytes, then read global light BGRA color
    let global_b = read_f32_from_memory(light_obj_ptr + 36)?;
    let global_g = read_f32_from_memory(light_obj_ptr + 40)?;
    let global_r = read_f32_from_memory(light_obj_ptr + 44)?;
    let global_a = read_f32_from_memory(light_obj_ptr + 48)?;

    let light1 = read_light_definition(light1_ptr)?;
    let light2 = read_light_definition(light2_ptr)?;
    let light3 = read_light_definition(light3_ptr)?;

    let global_light_color = convert_bgra_to_rgb(global_b, global_g, global_r, global_a);

    Ok(FieldLights {
        global_light_color,
        light1,
        light2,
        light3,
    })
}

pub fn read_field_models(addresses: &FF7Addresses) -> Result<Vec<FieldModel>, String> {
    let mut models: Vec<FieldModel> = Vec::new();

    let models_num = read_memory_byte(addresses.field_num_models)? as u32;
    let model_ptr = read_memory_int(addresses.field_models_ptr)?;
    if model_ptr == 0 {
        return Ok(models);
    }

    for i in 0..models_num {
        let base_address = model_ptr + i * 400;
        let base_address_2 = addresses.field_models_objs + i * 0x88;

        // Read lights for this specific model
        let lights = read_field_lights(i, addresses)?;

        let model = FieldModel {
            x: read_memory_signed_int(base_address + 4)?,
            y: read_memory_signed_int(base_address + 8)?,
            z: read_memory_signed_int(base_address + 0xc)? + 10, // field model Z coords are offset by 10
            direction: read_memory_byte(base_address + 0x1c)?,
            triangle: read_memory_short(base_address_2 + 0x78)?,
            collision: read_memory_byte(base_address_2 + 0x5f)?,
            interaction: read_memory_byte(base_address_2 + 0x61)?,
            visible: read_memory_byte(base_address_2 + 0x62)?,
            collision_range: read_memory_short(base_address_2 + 0x72)?,
            talk_range: read_memory_short(base_address_2 + 0x74)?,
            lights,
        };
        models.push(model);
    }
    Ok(models)
}

pub fn read_field_data(addresses: &FF7Addresses) -> Result<FieldData, String> {
    let field_id = read_memory_short(addresses.field_id)?;
    let field_name = read_memory_buffer(addresses.field_name, 16)?;
    let field_data_addr = read_memory_int(addresses.field_data_ptr)?;
    if field_data_addr == 0 {
        return Ok(FieldData {
            field_id,
            field_name,
            field_model_count: 0,
            field_model_names: Vec::new(),
        });
    }

    let section3_offset = read_memory_int(field_data_addr + 0x0e)?;
    let section3_addr = field_data_addr + section3_offset + 4;
    let field_model_count = read_memory_short(section3_addr + 2)?;
    let models_addr = section3_addr + 6;

    let mut field_model_names = Vec::new();
    let mut offset = 0;
    for _i in 0..field_model_count {
        let model_name_size = read_memory_short(models_addr + offset)?;
        let model_name = read_memory_buffer(models_addr + offset + 2, model_name_size as usize)?;
        let model_animation_count =
            read_memory_short(models_addr + offset + model_name_size as u32 + 16)?;
        field_model_names.push(String::from_utf8(model_name).unwrap_or(String::from("???")));
        offset += model_name_size as u32 + 48;

        for _j in 0..model_animation_count {
            let animation_name_size = read_memory_short(models_addr + offset)?;
            offset += animation_name_size as u32 + 4;
        }
    }

    Ok(FieldData {
        field_id,
        field_name,
        field_model_count,
        field_model_names,
    })
}

pub fn read_field_line_objs(addresses: &FF7Addresses) -> Result<Vec<FieldLineObj>, String> {
    let mut field_line_objs = Vec::new();

    for i in 0..32 {
        let base_address = addresses.field_line_objs + i * 0x18;
        let field_line_obj = FieldLineObj {
            x1: read_memory_signed_short(base_address + 0x00)?,
            y1: read_memory_signed_short(base_address + 0x02)?,
            z1: read_memory_signed_short(base_address + 0x04)?,
            x2: read_memory_signed_short(base_address + 0x06)?,
            y2: read_memory_signed_short(base_address + 0x08)?,
            z2: read_memory_signed_short(base_address + 0x0a)?,
            enabled: read_memory_byte(base_address + 0x0c)?,
            entity: read_memory_byte(base_address + 0x0d)?,
        };
        if field_line_obj.entity > 0 {
            field_line_objs.push(field_line_obj);
        }
    }
    Ok(field_line_objs)
}

fn convert_rgb_to_bgra_f32(color: [u8; 3]) -> (f32, f32, f32, f32) {
    let r = color[0] as f32 / 255.0;
    let g = color[1] as f32 / 255.0;
    let b = color[2] as f32 / 255.0;
    let a = 1.0; // Alpha is always 1.0 for field lights
    (b, g, r, a)
}

fn convert_xyz_to_field_coordinates(x: i32, y: i32, z: i32) -> (f32, f32, f32) {
    let fx = -(x as f32) / 4096.0;
    let fy = -(z as f32) / 4096.0;
    let fz = (y as f32) / 4096.0;
    (fx, fy, fz)
}

fn write_f32_to_memory(address: u32, value: f32) -> Result<(), String> {
    let int_val = value.to_bits();
    write_memory_int(address, int_val)
}

fn write_light_definition(light_ptr: u32, light: &Light) -> Result<(), String> {
    // Skip 4 bytes (always 0)
    // Skip 4 bytes (hex color - intermediate value)
    let (fx, fy, fz) = convert_xyz_to_field_coordinates(light.x, light.y, light.z);
    write_f32_to_memory(light_ptr + 8, fx)?;
    write_f32_to_memory(light_ptr + 12, fy)?;
    write_f32_to_memory(light_ptr + 16, fz)?;

    // Write BGRA color (4 * 4 bytes)
    let (color_b, color_g, color_r, color_a) = convert_rgb_to_bgra_f32(light.color);
    write_f32_to_memory(light_ptr + 20, color_b)?;
    write_f32_to_memory(light_ptr + 24, color_g)?;
    write_f32_to_memory(light_ptr + 28, color_r)?;
    write_f32_to_memory(light_ptr + 32, color_a)?;

    Ok(())
}

pub fn write_field_lights(lights: &FieldLights, model_index: u32, addresses: &FF7Addresses) -> Result<(), String> {
    // Validate model index
    let models_num = read_memory_byte(addresses.field_num_models)? as u32;
    if model_index >= models_num {
        return Err(format!("Model index {} is out of range (0-{})", model_index, models_num - 1));
    }

    // Get the pointer to the specific model's light object
    let light_obj_ptr = read_memory_int(addresses.field_light_table + model_index * 4)?;
    if light_obj_ptr == 0 {
        return Err(format!("Light object pointer for model {} is null", model_index));
    }

    // Get light pointers for this specific model
    let light1_ptr = read_memory_int(light_obj_ptr + 8)?;
    let light2_ptr = read_memory_int(light_obj_ptr + 12)?;
    let light3_ptr = read_memory_int(light_obj_ptr + 16)?;

    // Write individual lights
    write_light_definition(light1_ptr, &lights.light1)?;
    write_light_definition(light2_ptr, &lights.light2)?;
    write_light_definition(light3_ptr, &lights.light3)?;

    // Write global light BGRA color (skip 16 bytes, then write)
    let (global_b, global_g, global_r, global_a) = convert_rgb_to_bgra_f32(lights.global_light_color);
    write_f32_to_memory(light_obj_ptr + 36, global_b)?;
    write_f32_to_memory(light_obj_ptr + 40, global_g)?;
    write_f32_to_memory(light_obj_ptr + 44, global_r)?;
    write_f32_to_memory(light_obj_ptr + 48, global_a)?;

    Ok(())
}

fn decode_encounter_pair(packed: u16) -> EncounterPair {
    EncounterPair {
        rate: (packed >> 10) as u8,
        encounter_id: packed & 0x3ff,
    }
}

fn read_encounter_set(base_address: u32) -> Result<FieldEncounterSet, String> {
    let enabled = read_memory_byte(base_address)?;
    let encounter_rate = read_memory_byte(base_address + 1)?;
    
    let mut normal_encounters = Vec::new();
    for i in 0..6 {
        let packed = read_memory_short(base_address + 2 + i * 2)?;
        normal_encounters.push(decode_encounter_pair(packed));
    }
    
    let mut back_attacks = Vec::new();
    for i in 0..2 {
        let packed = read_memory_short(base_address + 14 + i * 2)?;
        back_attacks.push(decode_encounter_pair(packed));
    }
    
    let side_attack_packed = read_memory_short(base_address + 18)?;
    let side_attack = decode_encounter_pair(side_attack_packed);
    
    let pincer_attack_packed = read_memory_short(base_address + 20)?;
    let pincer_attack = decode_encounter_pair(pincer_attack_packed);
    
    Ok(FieldEncounterSet {
        active: enabled != 0,
        encounter_rate,
        normal_encounters,
        back_attacks,
        side_attack,
        pincer_attack,
    })
}

fn empty_encounter_set() -> FieldEncounterSet {
    FieldEncounterSet {
        active: false,
        encounter_rate: 0,
        normal_encounters: Vec::new(),
        back_attacks: Vec::new(),
        side_attack: EncounterPair { rate: 0, encounter_id: 0 },
        pincer_attack: EncounterPair { rate: 0, encounter_id: 0 },
    }
}

pub fn read_field_encounters(addresses: &FF7Addresses) -> Result<FieldEncounterTables, String> {
    let field_data_ptr = read_memory_int(addresses.field_data_ptr)?;
    if field_data_ptr == 0 {
        return Ok(FieldEncounterTables {
            table1: empty_encounter_set(),
            table2: empty_encounter_set(),
        });
    }
    
    let section7_offset = read_memory_int(addresses.field_section_offsets + 6 * 4)?;
    let encounter_data_addr = field_data_ptr + 4 + section7_offset;
    
    let table1 = read_encounter_set(encounter_data_addr)?;
    let table2 = read_encounter_set(encounter_data_addr + 24)?;
    
    Ok(FieldEncounterTables {
        table1,
        table2,
    })
}
