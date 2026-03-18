# Known Issues

- The cache file gets too big, and loading it takes too long
- We don't properly close all the files we open (both WASM loads and parsed files)
- When pressing `Enter` in the searchbox, a new search should be triggered even if the query is unchanged

## Possible solutions

### Cache

Currently we use JSON, which is impractical for our purposes as the cache files for large projects are
over 200MiB.
We want it to be smaller, and for loading to be faster.

It is important to note that the cache serves multiple purposes:

1. if a file is in the cache, we don't need to parse it again unless it is changed;
2. we match our query against the strings in the cache
3. we get the locations for the relevant query matches

Those 3 things can be handled by different representations of the data.

#### 1. What to re-parse

For this, all we need is paths and file hashes.
This can be stored separately from the rest of the cache so it is quick to load and query.

#### 2. Matching strings

For matching, all we need is the strings themselves.
There is no need to load the location data before we get an actual match.

The string literals are also the biggest chunk of data, so being able to 
deduplicate and compress them might be a good idea.

Once we have a matched string, we can find the file locations it is in based on an index of sorts.

#### 4. Location Info

In large codebases, we'll likely match ~100 strings out of hundreds-of-thousands.
It's a waste to load all this location data into memory before we actually know which strings
are of interest.

#### Proposed Architecture

I think the way to go is to split the cache into multiple files.

One file will contain all the strings.
It should have them separated by some separator character (`\0` is probably a good option),
so that the file is effectively a long string itself.
We can save it zipped to save both space and load time, and break it up as we load it.
The strings should be deduplicated before saving, to reduce memory and disk usage, and to avoid
matching against identical strings.

A second file should be the parsing cache. The only thing it needs to do is indicate
which files were already parsed, and what their hashes were, so that we avoid parsing them again.

The third file is the locations.
It should allow mapping from the index of a string in the first file, to all it's matching file locations.

Since both the second and third files require simple lookups, I think they might be well served by SQLite.

Together, this should give us much better cache performance.
Note that this will also require a change in the in-memory cache, as it should use the same structure.