import json, os

_HERE   = os.path.dirname(os.path.abspath(__file__))
_HOME   = os.path.join(os.path.expanduser("~"), ".zipper_tools")
DB_PATH = os.environ.get(
    "ZIPPER_DB_PATH",
    os.path.join(_HOME, "tools_db.json")
)

def load_tools():
    if not os.path.exists(DB_PATH):
        return {}
    with open(DB_PATH) as f:
        return json.load(f)

def save_tools(data):
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with open(DB_PATH, "w") as f:
        json.dump(data, f, indent=2)
