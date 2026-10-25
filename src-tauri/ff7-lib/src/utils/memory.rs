use crate::utils::process;
use process_memory::{CopyAddress, DataMember, Memory, PutAddress, ProcessHandle};
use std::backtrace::Backtrace;
use winapi::um::memoryapi::VirtualProtectEx;
use winapi::um::winnt::{PAGE_EXECUTE_READWRITE, PVOID};

fn handle_memory_error(err: impl std::fmt::Display, address: u32) -> String {
    // Invalidate the handle so we can get a fresh one
    process::invalidate_handle();
    format!(
        "Could not access memory at address 0x{:08X}\nError: {}\nBacktrace: {}",
        address,
        err,
        Backtrace::force_capture()
    )
}

fn get_process_handle() -> Result<ProcessHandle, String> {
    process::get_process_handle()
        .ok_or_else(|| "Process not found".to_string())
}

fn access_memory<T: Copy, F>(address: u32, operation: F) -> Result<T, String>
where
    F: FnOnce(&mut DataMember<T>) -> Result<T, String>,
{
    let handle = get_process_handle()?;
    let mut value = DataMember::<T>::new(handle);
    value.set_offset(vec![address.try_into().unwrap()]);
    operation(&mut value)
}

fn read_memory<T: Copy>(address: u32) -> Result<T, String> {
    access_memory(address, |value| unsafe {
        value.read().map_err(|e| handle_memory_error(e, address))
    })
}

fn write_memory<T: Copy>(address: u32, new_value: T) -> Result<(), String> {
    access_memory(address, |value| {
        value.write(&new_value).map_err(|e| handle_memory_error(e, address))?;
        Ok(new_value)
    })?;
    Ok(())
}

pub fn read_memory_int(address: u32) -> Result<u32, String> {
    read_memory::<u32>(address)
}

pub fn read_memory_signed_int(address: u32) -> Result<i32, String> {
    read_memory::<i32>(address)
}

pub fn read_memory_short(address: u32) -> Result<u16, String> {
    read_memory::<u16>(address)
}

pub fn read_memory_signed_short(address: u32) -> Result<i16, String> {
    read_memory::<i16>(address)
}

pub fn read_memory_byte(address: u32) -> Result<u8, String> {
    read_memory::<u8>(address)
}

pub fn read_memory_float(address: u32) -> Result<f64, String> {
    read_memory::<f64>(address)
}

pub fn read_memory_buffer(address: u32, size: usize) -> Result<Vec<u8>, String> {
    let handle = get_process_handle()?;
    let mut buf = vec![0u8; size];
    handle
        .copy_address(address as usize, &mut buf)
        .map_err(|e| handle_memory_error(e, address))?;
    Ok(buf)
}

pub fn write_memory_buffer(address: u32, mut buffer: Vec<u8>) -> Result<(), String> {
    let handle = get_process_handle()?;
    handle
        .put_address(address as usize, &mut buffer)
        .map_err(|e| handle_memory_error(e, address))?;
    Ok(())
}

pub fn write_memory_int(address: u32, new_value: u32) -> Result<(), String> {
    write_memory::<u32>(address, new_value)
}

pub fn write_memory_short(address: u32, new_value: u16) -> Result<(), String> {
    write_memory::<u16>(address, new_value)
}

pub fn write_memory_signed_short(address: u32, new_value: i16) -> Result<(), String> {
    write_memory::<i16>(address, new_value)
}

pub fn write_memory_signed_int(address: u32, new_value: i32) -> Result<(), String> {
    write_memory::<i32>(address, new_value)
}

pub fn write_memory_byte(address: u32, new_value: u8) -> Result<(), String> {
    write_memory::<u8>(address, new_value)
}

pub fn write_memory_float(address: u32, new_value: f64) -> Result<(), String> {
    write_memory::<f64>(address, new_value)
}

pub fn set_memory_protection(address: u32, size: usize) -> Result<(), String> {
    let handle = get_process_handle()?;
    let mut old_protect = 0;

    let result = unsafe {
        VirtualProtectEx(
            handle.0,
            address as PVOID,
            size,
            PAGE_EXECUTE_READWRITE,
            &mut old_protect,
        )
    };

    if result == 0 {
        Err(handle_memory_error("Failed to change memory protection", address))
    } else {
        Ok(())
    }
}
