pub mod memory;
pub mod process;

pub fn flip_bits<T>(value: T) -> T 
where 
    T: std::ops::Not<Output = T>
{
    !value
}
