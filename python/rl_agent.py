import torch
import torch.nn as nn
import torch.optim as optim
from torch.distributions import Normal
import os
import sqlite3
import time
import json

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
        # Actions: [CPU_PWM, Case_PWM, Pump_PWM, PL1, GPU_PL, CPU_Freq_Global, Voltage_Offset, Core0_Freq..Core7_Freq]
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
        self.actor = ContinuousActor(state_dim=7, action_dim=15)
        self.critic = Critic(state_dim=7)
        self.actor_optimizer = optim.Adam(self.actor.parameters(), lr=3e-4)
        self.critic_optimizer = optim.Adam(self.critic.parameters(), lr=1e-3)
        
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
        
        # Training metrics state
        self.metrics = {"actor_loss": 0.0, "critic_loss": 0.0, "reward": 0.0, "entropy": 0.0, "steps": 0}
        self.experience_buffer = []  # (state, action_logprob, reward, next_state)
        self.metrics_path = "/tmp/thermal_rl_metrics.json"

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
        Returns: cpu_pwm, case_pwm, pump_pwm, pl1_watts, gpu_watts, cpu_freq_mhz, voltage_offset_mv
        """
        state_tensor = torch.tensor(state_list, dtype=torch.float32).unsqueeze(0)
        mu, std = self.actor(state_tensor)
        
        # Sample from policy distribution for exploration
        dist = Normal(mu, std)
        action_sample = dist.sample()
        action_logprob = dist.log_prob(action_sample).sum(dim=-1)
        entropy = dist.entropy().sum(dim=-1).item()
        
        actions = action_sample.squeeze(0).clamp(0, 1).numpy()  # [0..1]
        
        cpu_pwm = int(self.pwm_min + actions[0] * (self.pwm_max - self.pwm_min))
        case_pwm = int(self.pwm_min + actions[1] * (self.pwm_max - self.pwm_min))
        pump_pwm = int(self.pwm_min + actions[2] * (self.pwm_max - self.pwm_min))
        pl1_watts = self.pl1_min + actions[3] * (self.pl1_max - self.pl1_min)
        gpu_watts = self.gpu_min + actions[4] * (self.gpu_max - self.gpu_min)
        cpu_freq_mhz = int(self.cpu_freq_min + actions[5] * (self.cpu_freq_max - self.cpu_freq_min))
        voltage_offset_mv = int(self.voltage_min + actions[6] * (self.voltage_max - self.voltage_min))
        
        # Per-core frequency targets (actions[7..14])
        per_core_freqs = []
        for i in range(8):
            freq = int(self.cpu_freq_min + actions[7 + i] * (self.cpu_freq_max - self.cpu_freq_min))
            per_core_freqs.append(freq)
        
        # Store for training
        self._last_state = state_tensor
        self._last_logprob = action_logprob
        self._last_entropy = entropy
        self.metrics["entropy"] = entropy
        
        return cpu_pwm, case_pwm, pump_pwm, pl1_watts, gpu_watts, cpu_freq_mhz, voltage_offset_mv, per_core_freqs

    def compute_reward(self, cpu_temp, gpu_temp, pwm, watts, ssd_temp=35.0, ram_temp=40.0):
        """Reward: keep temps low, fans quiet, power efficient."""
        # Temperature penalty (exponential above 70C for CPU, 60C for SSD)
        temp_penalty = 0.0
        if cpu_temp > 70:
            temp_penalty += -((cpu_temp - 70) ** 2) * 0.01
        elif cpu_temp < 60:
            temp_penalty += 0.5  # bonus for staying cool
            
        if ssd_temp > 60:
            temp_penalty += -((ssd_temp - 60) ** 2) * 0.02
        if ram_temp > 65:
            temp_penalty += -((ram_temp - 65) ** 2) * 0.01
        
        # Fan noise penalty (prefer lower PWM)
        noise_penalty = -(pwm / 255.0) * 0.3
        
        # Power efficiency bonus
        power_bonus = max(0, (150 - watts) / 150.0) * 0.2
        
        reward = temp_penalty + noise_penalty + power_bonus
        return reward

    def train_step(self, next_state_list, reward):
        """Single-step Actor-Critic update with logged metrics."""
        if not hasattr(self, '_last_state'):
            return
        
        next_state = torch.tensor(next_state_list, dtype=torch.float32).unsqueeze(0)
        reward_t = torch.tensor([[reward]], dtype=torch.float32)
        
        # Critic update
        value = self.critic(self._last_state)
        next_value = self.critic(next_state).detach()
        advantage = reward_t + 0.99 * next_value - value
        critic_loss = advantage.pow(2).mean()
        
        self.critic_optimizer.zero_grad()
        critic_loss.backward()
        self.critic_optimizer.step()
        
        # Actor update (policy gradient with advantage)
        actor_loss = -(self._last_logprob * advantage.detach()).mean()
        
        self.actor_optimizer.zero_grad()
        actor_loss.backward()
        self.actor_optimizer.step()
        
        # Update metrics
        self.metrics["actor_loss"] = actor_loss.item()
        self.metrics["critic_loss"] = critic_loss.item()
        self.metrics["reward"] = reward
        self.metrics["steps"] += 1
        
        # Persist metrics for the API to read
        if self.metrics["steps"] % 5 == 0:
            try:
                with open(self.metrics_path, "w") as f:
                    json.dump({**self.metrics, "timestamp": time.time()}, f)
            except: pass
        
        # Save weights periodically
        if self.metrics["steps"] % 100 == 0:
            self.save_weights()

    def reset_brain(self):
        """Wipe all learned weights and reinitialize fresh."""
        self.actor = ContinuousActor(state_dim=5, action_dim=15)
        self.critic = Critic(state_dim=5)
        self.actor_optimizer = optim.Adam(self.actor.parameters(), lr=3e-4)
        self.critic_optimizer = optim.Adam(self.critic.parameters(), lr=1e-3)
        self.metrics = {"actor_loss": 0.0, "critic_loss": 0.0, "reward": 0.0, "entropy": 0.0, "steps": 0}
        self.experience_buffer = []
        if os.path.exists(self.weights_path):
            os.remove(self.weights_path)
        try:
            with open(self.metrics_path, "w") as f:
                json.dump({**self.metrics, "timestamp": time.time()}, f)
        except: pass
