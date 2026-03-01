use keyring::Entry;

const SERVICE: &str = "faber";

pub fn store(provider: &str, key: &str) -> Result<(), keyring::Error> {
    let entry = Entry::new(SERVICE, provider)?;
    entry.set_password(key)
}

pub fn get(provider: &str) -> Result<Option<String>, keyring::Error> {
    let entry = Entry::new(SERVICE, provider)?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn delete(provider: &str) -> Result<bool, keyring::Error> {
    let entry = Entry::new(SERVICE, provider)?;
    match entry.delete_credential() {
        Ok(()) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_creation_does_not_panic() {
        // Just verify we can create entries without panicking.
        // Actual keyring operations require an OS keychain and are
        // not reliable in headless CI environments.
        let _entry = Entry::new(SERVICE, "test-provider");
    }
}
