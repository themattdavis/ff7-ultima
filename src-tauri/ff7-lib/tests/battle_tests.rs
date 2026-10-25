use ff7_lib::ff7::data::battle::read_scene_bin_from_path;
use std::path::Path;

/// Test the read_scene_bin_from_path function using a real scene.bin file
#[test]
fn test_read_scene_bin() {
    // Path to the test file
    let scene_bin_path = Path::new("tests/data/scene.bin");
    
    // Call the function with our test file
    let result = read_scene_bin_from_path(&scene_bin_path);
    
    // Verify the result
    assert!(result.is_ok(), "read_scene_bin_from_path returned an error: {:?}", result.err());

    let scenes_vec = result.unwrap();
    let num_scenes = scenes_vec.len();

    // Make sure we got at least one scene (adjust expected number if necessary)
    // The original test expected >= 256, let's keep that for now.
    assert!(num_scenes >= 256, "Expected at least 256 scenes, got {}", num_scenes);

    // Output the number of scenes found for informational purposes
    println!("Successfully parsed {} scenes from scene.bin", num_scenes);
}
