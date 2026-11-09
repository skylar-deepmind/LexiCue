use std::{env, fs, path::PathBuf, process::Command};

fn xcrun(args: &[&str]) -> String {
    let output = Command::new("xcrun")
        .args(args)
        .output()
        .expect("Xcode is required to build the Apple device sync transport");
    assert!(output.status.success(), "xcrun {args:?} failed");
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

pub fn build() {
    let target = env::var("TARGET").unwrap();
    let arch = if target.starts_with("aarch64") {
        "arm64"
    } else {
        "x86_64"
    };
    let (sdk, triple) = if target.ends_with("apple-darwin") {
        let min = if arch == "arm64" { "11.0" } else { "10.13" };
        ("macosx", format!("{arch}-apple-macos{min}"))
    } else if target.ends_with("apple-ios-sim") || target == "x86_64-apple-ios" {
        ("iphonesimulator", format!("{arch}-apple-ios15.0-simulator"))
    } else if target.ends_with("apple-ios") {
        ("iphoneos", format!("{arch}-apple-ios15.0"))
    } else {
        return;
    };
    let sources = PathBuf::from("native/lan-sync");
    println!("cargo:rerun-if-changed={}", sources.display());
    let mut swift = fs::read_dir(sources)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "swift"))
        .collect::<Vec<_>>();
    swift.sort();
    let sdk_path = xcrun(&["--sdk", sdk, "--show-sdk-path"]);
    let compiler = PathBuf::from(xcrun(&["--find", "swiftc"]));
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let status = Command::new(&compiler)
        .args(["-sdk", &sdk_path, "-target", &triple, "-parse-as-library"])
        .args([
            "-emit-library",
            "-static",
            "-module-name",
            "LexiCueDeviceSync",
        ])
        .arg(if env::var("PROFILE").unwrap() == "release" {
            "-O"
        } else {
            "-Onone"
        })
        .args(swift)
        .arg("-o")
        .arg(out.join("libLexiCueDeviceSync.a"))
        .status()
        .expect("failed to execute swiftc");
    assert!(
        status.success(),
        "building the Apple device sync transport failed"
    );
    let swift_libs = compiler
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("lib/swift")
        .join(sdk);
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-search=native={}", swift_libs.display());
    println!("cargo:rustc-link-search=native={sdk_path}/usr/lib/swift");
    println!("cargo:rustc-link-lib=static=LexiCueDeviceSync");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}
