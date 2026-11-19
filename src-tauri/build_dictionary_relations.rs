use crate::relation_sql::PACK_ALIAS_EVIDENCE;
use rusqlite::{Connection, OpenFlags};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

pub fn generate(database: &Path) -> rusqlite::Result<()> {
    let db = Connection::open_with_flags(database, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let integrity: String = db.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    assert_eq!(integrity, "ok", "Bundled dictionary integrity check failed");

    let mut query = db.prepare("SELECT id,word FROM surfaces")?;
    let spellings = query
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<HashMap<_, _>>>()?;
    let mut query = db.prepare("SELECT DISTINCT surface_id FROM entries")?;
    let heads = query
        .query_map([], |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<HashSet<_>>>()?;

    let mut identities: BTreeMap<&str, Vec<&str>> = spellings
        .values()
        .map(|word| (word.as_str(), vec![]))
        .collect();
    let mut forms = BTreeMap::<&str, Vec<&str>>::new();
    let mut case = BTreeMap::<String, Vec<&str>>::new();
    let mut query = db.prepare(PACK_ALIAS_EVIDENCE)?;
    for row in query.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, bool>(3)?,
        ))
    })? {
        let (surface, first, last, inflected) = row?;
        if inflected && first == last && !heads.contains(&surface) && heads.contains(&first) {
            let surface = spellings[&surface].as_str();
            let target = spellings[&first].as_str();
            identities.get_mut(surface).unwrap().push(target);
            forms
                .entry(target)
                .or_insert_with(|| vec![target])
                .push(surface);
        }
    }
    for spelling in spellings.values() {
        if spelling.chars().any(char::is_uppercase) {
            case.entry(spelling.to_lowercase())
                .or_default()
                .push(spelling);
        }
    }
    for values in forms.values_mut().chain(case.values_mut()) {
        values.sort_unstable();
    }

    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("Missing cargo output directory"));
    write_table(
        &out.join("dictionary-identities.bin"),
        identities.into_iter(),
    );
    write_table(&out.join("dictionary-forms.bin"), forms.into_iter());
    write_table(
        &out.join("dictionary-case.bin"),
        case.iter()
            .map(|(key, values)| (key.as_str(), values.clone())),
    );
    Ok(())
}

/// Sorted UTF-8 rows. A leading u32 count is followed by count+1 u32
/// offsets into the row body. Each row holds one key and zero or more
/// NUL-separated values. No runtime deserialization or allocations needed.
fn write_table<'a>(path: &Path, rows: impl ExactSizeIterator<Item = (&'a str, Vec<&'a str>)>) {
    let mut file = BufWriter::new(File::create(path).expect("Cannot create dictionary index"));
    let mut bytes = Vec::new();
    file.write_all(&u32::try_from(rows.len()).unwrap().to_le_bytes())
        .unwrap();
    for (word, values) in rows {
        file.write_all(&u32::try_from(bytes.len()).unwrap().to_le_bytes())
            .unwrap();
        assert!(!word.contains('\0'));
        bytes.extend_from_slice(word.as_bytes());
        for value in values {
            assert!(!value.contains('\0'));
            bytes.push(0);
            bytes.extend_from_slice(value.as_bytes());
        }
    }
    file.write_all(&u32::try_from(bytes.len()).unwrap().to_le_bytes())
        .unwrap();
    file.write_all(&bytes).unwrap();
    file.flush().unwrap();
}
