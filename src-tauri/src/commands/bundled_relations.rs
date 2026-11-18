//! Immutable relation tables generated from the verified daily pack at build time.
struct Table(&'static [u8]);

impl Table {
    fn index_word(&self, index: usize) -> usize {
        let at = index * 4;
        u32::from_le_bytes(self.0[at..at + 4].try_into().unwrap()) as usize
    }

    fn values(&self, key: &str) -> Option<impl Iterator<Item = &'static str>> {
        let count = self.index_word(0);
        let body = &self.0[(count + 2) * 4..];
        let (mut low, mut high) = (0, count);
        while low < high {
            let mid = low + (high - low) / 2;
            let row = &body[self.index_word(mid + 1)..self.index_word(mid + 2)];
            let mut fields = row.split(|byte| *byte == 0);
            match fields.next().unwrap().cmp(key.as_bytes()) {
                std::cmp::Ordering::Less => low = mid + 1,
                std::cmp::Ordering::Greater => high = mid,
                std::cmp::Ordering::Equal => {
                    return Some(fields.map(|value| std::str::from_utf8(value).unwrap()));
                }
            }
        }
        None
    }
}

const IDENTITIES: Table = Table(include_bytes!(concat!(
    env!("OUT_DIR"),
    "/dictionary-identities.bin"
)));
const FORMS: Table = Table(include_bytes!(concat!(
    env!("OUT_DIR"),
    "/dictionary-forms.bin"
)));
const CASE: Table = Table(include_bytes!(concat!(
    env!("OUT_DIR"),
    "/dictionary-case.bin"
)));

pub(super) fn known(word: &str) -> bool {
    IDENTITIES.values(word).is_some()
}

pub(super) fn identity(word: &str) -> Option<&'static str> {
    IDENTITIES.values(word)?.next()
}

pub(super) fn forms(word: &str) -> impl Iterator<Item = &'static str> {
    FORMS.values(word).into_iter().flatten()
}

pub(super) fn case(folded: &str) -> impl Iterator<Item = &'static str> {
    CASE.values(folded).into_iter().flatten()
}
