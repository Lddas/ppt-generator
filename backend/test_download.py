"""The generated file is streamed in chunks (Cloud Run: no plain HTTP/1 response above 32 MiB)."""
import main

data = bytes(range(256)) * 20000  # 5 MB
parts = list(main.chunked(data))
assert b"".join(parts) == data and all(len(p) <= 1 << 20 for p in parts) and len(parts) == 5
assert list(main.chunked(b"")) == []
print("test_download: ok")
