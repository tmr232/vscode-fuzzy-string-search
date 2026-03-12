x = "hello world"
y = 'single quotes'
z = """triple quoted string"""
w = '''triple single quoted'''

# f-strings
greeting = f"hello {name}"
multi = f"a {x} b {y} c"

# raw and byte strings
raw = r"raw\nstring"
byteval = b"byte string"

# concatenated strings
combined = ("hello " "world")

# concatenated with comment
multi_concat = (
    "first"  # inline comment
    "second"
)

# nested f-string interpolation
nested = f"outer {inner} end"

# empty string
empty = ""

# multiline triple-quoted
multiline = """line one
line two
line three"""
