import json, os

DB_PATH = "server/tools_db.json"

def load_tools():
    if not os.path.exists(DB_PATH):
        return {}
    with open(DB_PATH) as f:
        return json.load(f)

def save_tools(data):
    with open(DB_PATH, "w") as f:
        json.dump(data, f, indent=2)
