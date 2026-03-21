# Known Issues

- We don't properly close all the files we open (both WASM loads and parsed files)
- When pressing `Enter` in the searchbox, a new search should be triggered even if the query is unchanged
