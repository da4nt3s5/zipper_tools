import json, os

_HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_HERE, "tools_db.json")

def load_tools():
    if not os.path.exists(DB_PATH):
        return {}
    with open(DB_PATH) as f:
        return json.load(f)

def save_tools(data):
    with open(DB_PATH, "w") as f:
        json.dump(data, f, indent=2)
