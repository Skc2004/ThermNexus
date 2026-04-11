import tomllib
import os

def load_config():
    config_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.toml")
    with open(config_path, "rb") as f:
        return tomllib.load(f)
