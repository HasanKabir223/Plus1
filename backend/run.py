import sys
import uvicorn
from pathlib import Path

# Ensure root workspace is on python sys.path
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

if __name__ == "__main__":
    print(f"Starting Plus1 Python Backend on Python {sys.version.split()[0]} (http://127.0.0.1:8000)...")
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
