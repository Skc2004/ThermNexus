import torch
import torch.nn as nn
import torch.optim as optim
import sqlite3
import os

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "models")
os.makedirs(OUTPUT_DIR, exist_ok=True)
MODEL_WEIGHTS = os.path.join(OUTPUT_DIR, "thermal_predictor.pt")
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "thermal_profile.db")

class ThermalPredictor(nn.Module):
    def __init__(self):
        super(ThermalPredictor, self).__init__()
        # Inputs: [PageAlloc_Velocity, CPU_Temp, GPU_Temp, CurrentWatts]
        self.linear1 = nn.Linear(4, 32) 
        self.relu = nn.ReLU()
        self.linear2 = nn.Linear(32, 1)
        
    def forward(self, x):
        x = self.linear1(x)
        x = self.relu(x)
        return self.linear2(x)

def load_data():
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT timestamp, cpu_temp, process_velocity, fan_rpm, target_pwm, gpu_temp, power_watts FROM thermal_logs ORDER BY timestamp ASC")
        data = c.fetchall()
        conn.close()
        return data
    except sqlite3.OperationalError:
        print(f"No {DB_PATH} found.")
        return []

def train():
    data = load_data()
    if len(data) < 15:
        print("Not enough data to train (need at least 15 rows).")
        return

    print(f"Loaded {len(data)} rows. Generating state sequences...")
    X = []
    y = []

    for i in range(len(data) - 5): # Predict 5 seconds ahead (profiler runs at 1Hz)
        row = data[i]
        future_row = data[i+5]
        
        timestamp, cpu_temp, process_velocity, fan_rpm, target_pwm, gpu_temp, power_watts = row
        future_timestamp, future_cpu_temp, _, _, _, _, _ = future_row

        features = [process_velocity, cpu_temp, gpu_temp, power_watts]
        target = future_cpu_temp
        
        X.append(features)
        y.append([target])

    X_tensor = torch.tensor(X, dtype=torch.float32)
    y_tensor = torch.tensor(y, dtype=torch.float32)

    model = ThermalPredictor()
    optimizer = optim.Adam(model.parameters(), lr=0.001)
    criterion = nn.MSELoss()

    epochs = 100
    for epoch in range(epochs):
        optimizer.zero_grad()
        predictions = model(X_tensor)
        loss = criterion(predictions, y_tensor)
        loss.backward()
        optimizer.step()

        if epoch % 10 == 0:
            print(f"Epoch {epoch}/{epochs} | MSE Loss: {loss.item():.4f}")

    torch.save(model.state_dict(), MODEL_WEIGHTS)
    print(f"Saved trained weights to {MODEL_WEIGHTS}")

if __name__ == "__main__":
    train()
