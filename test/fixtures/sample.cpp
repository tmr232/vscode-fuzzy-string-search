#include <string>

// Regular string literals
const char* simple = "hello world";
const char* with_escapes = "line1\nline2\ttab";
const char* empty = "";

// Prefixed string literals
const wchar_t* wide = L"wide string";
const char16_t* c16 = u"char16 string";
const char32_t* c32 = U"char32 string";
const char8_t* c8 = u8"char8 string";

// Raw string literals
const char* raw = R"(raw string content)";
const char* raw_delim = R"delim(raw with delim)delim";
const char* raw_multi = R"(line one
line two
line three)";

// Concatenated string literals
const char* concat = "hello " "world";
const char* concat3 = "a" "b" "c";

// User-defined string literal
std::string udl = "hello"s;
