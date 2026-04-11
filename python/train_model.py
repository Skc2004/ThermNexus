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
        self.lstm = nn.LSTM(input_size=4, hidden_size=64, num_layers=2, batch_first=True)
        self.linear = nn.Linear(64, 1)
        
    def forward(self, x):
        lstm_out, _ = self.lstm(x)
        return self.linear(lstm_out[:, -1, :])

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

    SEQ_LENGTH = 5
    for i in range(len(data) - SEQ_LENGTH - 5): # Predict 5 seconds ahead
        seq_features = []
        for j in range(SEQ_LENGTH):
            row = data[i + j]
            # timestamp, cpu_temp, process_velocity, fan_rpm, target_pwm, gpu_temp, power_watts
            _, cpu_temp, process_velocity, _, _, gpu_temp, power_watts = row
            seq_features.append([process_velocity, cpu_temp, gpu_temp, power_watts])
            
        future_row = data[i + SEQ_LENGTH + 5]
        future_cpu_temp = future_row[1]
        
        X.append(seq_features)
        y.append([future_cpu_temp])

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
