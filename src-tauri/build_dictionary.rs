//! A missing/tampered default dictionary must never produce an installer.
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::Path};
pub fn verify() {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/dictionaries");
    let manifest_path = base.join("daily/manifest.json");
    let catalog_path = base.join("catalog.json");
    println!("cargo:rerun-if-changed={}", manifest_path.display());
    println!("cargo:rerun-if-changed={}", catalog_path.display());
    let manifest: serde_json::Value = serde_json::from_slice(
        &fs::read(&manifest_path).expect("Bundled daily dictionary manifest is missing"),
    )
    .expect("Invalid daily dictionary manifest");
    let catalog: serde_json::Value =
        serde_json::from_slice(&fs::read(&catalog_path).expect("Dictionary catalog is missing"))
            .expect("Invalid dictionary catalog");
    let daily = catalog["packs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "daily")
        .expect("Default dictionary is missing");
    assert_eq!(catalog["default_pack_ids"], serde_json::json!(["daily"]));
    assert_eq!(manifest["files"]["dictionary.sqlite3"], daily["database"]);
    assert_eq!(manifest["pack_id"], "daily");
    assert_eq!(manifest["release"], catalog["release"]);
    assert!(daily["database"]["bytes"].as_u64().unwrap() <= 150_000_000);
    for (name, spec) in manifest["files"].as_object().unwrap() {
        assert_eq!(
            Path::new(name).file_name().and_then(|s| s.to_str()),
            Some(name.as_str())
        );
        let path = base.join("daily").join(name);
        println!("cargo:rerun-if-changed={}", path.display());
        let mut file = fs::File::open(&path).expect("Bundled dictionary member is missing");
        assert_eq!(
            file.metadata().unwrap().len(),
            spec["bytes"].as_u64().unwrap(),
            "Dictionary member size changed: {name}"
        );
        let mut sha = Sha256::new();
        let mut buf = [0u8; 65536];
        loop {
            let n = file.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            sha.update(&buf[..n]);
        }
        assert_eq!(
            format!("{:x}", sha.finalize()),
            spec["sha256"].as_str().unwrap(),
            "Dictionary member checksum changed: {name}"
        );
    }
}
