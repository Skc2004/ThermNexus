import torch
import torch.nn as nn
import torch.optim as optim
from torch.distributions import Normal
import os
import sqlite3

class ContinuousActor(nn.Module):
    def __init__(self, state_dim=5, action_dim=6):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(state_dim, 64),
            nn.LayerNorm(64),
            nn.ReLU(),
            nn.Linear(64, 64),
            nn.LayerNorm(64),
            nn.ReLU()
        )
        self.mu = nn.Sequential(
            nn.Linear(64, action_dim),
            nn.Sigmoid() # Bound between 0 and 1
        )
        self.log_std = nn.Parameter(torch.zeros(action_dim))

    def forward(self, state):
        features = self.net(state)
        # Actions: [CPU_PWM, Case_PWM, Pump_PWM, PL1, GPU_PL, CPU_Freq, Voltage_Offset]
        mu = self.mu(features)
        std = torch.exp(self.log_std).clamp(min=1e-3)
        return mu, std

class Critic(nn.Module):
    def __init__(self, state_dim=5):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(state_dim, 64),
            nn.LayerNorm(64),
            nn.ReLU(),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, 1)
        )

    def forward(self, state):
        return self.net(state)

class RLThermalAgent:
    def __init__(self, config):
        self.cfg = config
        self.actor = ContinuousActor(state_dim=5, action_dim=7)
        self.critic = Critic(state_dim=5)
        
        # Scaling limits
        self.pl1_min = self.cfg.get("rl", {}).get("pl1_min_watts", 15.0)
        self.pl1_max = self.cfg.get("rl", {}).get("pl1_max_watts", 150.0)
        self.pwm_min = self.cfg.get("mpc", {}).get("pwm_min", 40)
        self.pwm_max = self.cfg.get("mpc", {}).get("pwm_max", 255)
        
        self.gpu_min = self.cfg.get("rl", {}).get("gpu_min_watts", 100.0)
        self.gpu_max = self.cfg.get("rl", {}).get("gpu_max_watts", 350.0)
        self.cpu_freq_min = self.cfg.get("rl", {}).get("cpu_freq_min_mhz", 800)
        self.cpu_freq_max = self.cfg.get("rl", {}).get("cpu_freq_max_mhz", 5500)
        
        self.voltage_min = -150.0 # max undervolt
        self.voltage_max = 0.0    # default
        
        self.weights_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "models", "rl_actor_critic.pt"
        )
        self.load_weights()

    def load_weights(self):
        if os.path.exists(self.weights_path):
            try:
                checkpoint = torch.load(self.weights_path, weights_only=True)
                self.actor.load_state_dict(checkpoint['actor'])
                self.critic.load_state_dict(checkpoint['critic'])
                print(f"[RL Agent] Loaded weights from {self.weights_path}")
            except Exception as e:
                print(f"[RL Agent] Failed to load weights (architecture changed?): {e}. Initializing fresh PPO weights.")
        else:
            print("[RL Agent] Initialized fresh untrained PPO weights.")

    def save_weights(self):
        os.makedirs(os.path.dirname(self.weights_path), exist_ok=True)
        torch.save({
            'actor': self.actor.state_dict(),
            'critic': self.critic.state_dict()
        }, self.weights_path)

    def select_action(self, state_list):
        """
        state_list: [mem_velocity, cpu_temp, gpu_temp, current_watts, pred_t]
        Returns: cpu_pwm, case_pwm, pump_pwm, pl1_watts, gpu_watts, cpu_freq_mhz
        """
        state_tensor = torch.tensor(state_list, dtype=torch.float32).unsqueeze(0)
        with torch.no_grad():
            mu, _ = self.actor(state_tensor)
        
        actions = mu.squeeze(0).numpy() # [0..1]
        
        cpu_pwm = int(self.pwm_min + actions[0] * (self.pwm_max - self.pwm_min))
        case_pwm = int(self.pwm_min + actions[1] * (self.pwm_max - self.pwm_min))
        pump_pwm = int(self.pwm_min + actions[2] * (self.pwm_max - self.pwm_min))
        pl1_watts = self.pl1_min + actions[3] * (self.pl1_max - self.pl1_min)
        gpu_watts = self.gpu_min + actions[4] * (self.gpu_max - self.gpu_min)
        cpu_freq_mhz = int(self.cpu_freq_min + actions[5] * (self.cpu_freq_max - self.cpu_freq_min))
        voltage_offset_mv = int(self.voltage_min + actions[6] * (self.voltage_max - self.voltage_min))
        
        return cpu_pwm, case_pwm, pump_pwm, pl1_watts, gpu_watts, cpu_freq_mhz, voltage_offset_mv
