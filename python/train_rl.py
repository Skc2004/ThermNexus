import torch
import torch.nn as nn
import torch.optim as optim
from torch.distributions import Normal
import numpy as np
import os

from rl_agent import RLThermalAgent

class MockThermalEnv:
    def __init__(self):
        self.ambient_temp = 30.0
        self.cpu_temp = 40.0
        self.gpu_temp = 40.0
        self.current_watts = 20.0
        self.mem_velocity = 1000.0
        self.pred_t = 40.0
        self.step_count = 0
        self.max_steps = 100

    def reset(self):
        self.cpu_temp = 40.0
        self.gpu_temp = 40.0
        self.current_watts = 20.0
        self.step_count = 0
        return self._get_state()

    def _get_state(self):
        return [self.mem_velocity, self.cpu_temp, self.gpu_temp, self.current_watts, self.pred_t]

    def step(self, action):
        """
        action = [cpu_pwm, case_pwm, pump_pwm, pl1_watts, gpu_watts, cpu_freq_mhz]
        """
        self.step_count += 1
        cpu_pwm, case_pwm, pump_pwm, pl1_watts, gpu_watts, cpu_freq_mhz = action
        
        # Simulated Physics
        # Heat generation
        heat_cpu = (pl1_watts / 150.0) * 5.0 + (cpu_freq_mhz / 5500.0) * 3.0
        heat_gpu = (gpu_watts / 350.0) * 6.0
        
        # Cooling
        cool_cpu = (cpu_pwm / 255.0) * 4.0 + (pump_pwm / 255.0) * 2.0 + (case_pwm / 255.0) * 1.0
        cool_gpu = (case_pwm / 255.0) * 3.0
        
        # Thermal inertia
        self.cpu_temp = self.cpu_temp * 0.95 + self.ambient_temp * 0.05 + heat_cpu - cool_cpu
        self.gpu_temp = self.gpu_temp * 0.95 + self.ambient_temp * 0.05 + heat_gpu - cool_gpu
        
        self.cpu_temp = max(self.ambient_temp, min(self.cpu_temp, 110.0))
        self.gpu_temp = max(self.ambient_temp, min(self.gpu_temp, 110.0))
        
        self.current_watts = pl1_watts + gpu_watts + 20.0
        self.pred_t = self.cpu_temp + (heat_cpu - cool_cpu) * 5.0
        
        # Reward Function
        reward = 0.0
        
        # 1. Extreme penalty for overheating
        if self.cpu_temp > 85.0:
            reward -= (self.cpu_temp - 85.0) * 5.0
        elif self.cpu_temp < 75.0:
            # Reward for keeping it cool
            reward += 1.0
            
        if self.gpu_temp > 85.0:
            reward -= (self.gpu_temp - 85.0) * 5.0
            
        # 2. Reward for performance (maximize frequency and power if cool)
        reward += (cpu_freq_mhz / 5500.0) * 2.0
        reward += (pl1_watts / 150.0) * 1.0
        
        # 3. Penalty for acoustic noise (minimize fan speed)
        reward -= (cpu_pwm / 255.0) * 0.5
        reward -= (case_pwm / 255.0) * 0.3
        
        done = self.step_count >= self.max_steps
        return self._get_state(), reward, done

def train_ppo():
    config = {
        "rl": {
            "pl1_min_watts": 15.0, "pl1_max_watts": 150.0,
            "gpu_min_watts": 100.0, "gpu_max_watts": 350.0,
            "cpu_freq_min_mhz": 800, "cpu_freq_max_mhz": 5500
        },
        "mpc": {"pwm_min": 40, "pwm_max": 255}
    }
    
    agent = RLThermalAgent(config)
    env = MockThermalEnv()
    
    optimizer_actor = optim.Adam(agent.actor.parameters(), lr=1e-3)
    optimizer_critic = optim.Adam(agent.critic.parameters(), lr=5e-3)
    
    epochs = 200
    steps_per_epoch = 100
    gamma = 0.99
    clip_ratio = 0.2
    
    print("Starting PPO Training on Mock Thermal Environment...")
    
    for epoch in range(epochs):
        states, actions_ratios, log_probs_old, rewards, values = [], [], [], [], []
        state = env.reset()
        
        # Collect trajectories
        for _ in range(steps_per_epoch):
            state_tensor = torch.tensor(state, dtype=torch.float32).unsqueeze(0)
            with torch.no_grad():
                mu, std = agent.actor(state_tensor)
                val = agent.critic(state_tensor)
                
            dist = Normal(mu, std)
            action_ratio = dist.sample()
            log_prob = dist.log_prob(action_ratio).sum(dim=-1)
            action_ratio_clamped = torch.clamp(action_ratio, 0.0, 1.0).squeeze(0).numpy()
            
            # Map action ratio [0..1] to real physical bounds
            cpu_pwm = int(agent.pwm_min + action_ratio_clamped[0] * (agent.pwm_max - agent.pwm_min))
            case_pwm = int(agent.pwm_min + action_ratio_clamped[1] * (agent.pwm_max - agent.pwm_min))
            pump_pwm = int(agent.pwm_min + action_ratio_clamped[2] * (agent.pwm_max - agent.pwm_min))
            pl1_watts = agent.pl1_min + action_ratio_clamped[3] * (agent.pl1_max - agent.pl1_min)
            gpu_watts = agent.gpu_min + action_ratio_clamped[4] * (agent.gpu_max - agent.gpu_min)
            cpu_freq_mhz = int(agent.cpu_freq_min + action_ratio_clamped[5] * (agent.cpu_freq_max - agent.cpu_freq_min))
            
            physical_action = [cpu_pwm, case_pwm, pump_pwm, pl1_watts, gpu_watts, cpu_freq_mhz]
            next_state, reward, done = env.step(physical_action)
            
            states.append(state)
            actions_ratios.append(action_ratio.squeeze(0))
            log_probs_old.append(log_prob.squeeze(0))
            rewards.append(reward)
            values.append(val.squeeze(0))
            
            state = next_state
            if done:
                state = env.reset()
                
        # Calculate Advantages & Returns
        states_t = torch.tensor(states, dtype=torch.float32)
        actions_t = torch.stack(actions_ratios)
        log_probs_old_t = torch.stack(log_probs_old)
        rewards_t = torch.tensor(rewards, dtype=torch.float32)
        values_t = torch.stack(values).squeeze(-1)
        
        returns = []
        discounted_sum = 0
        for r in reversed(rewards):
            discounted_sum = r + gamma * discounted_sum
            returns.insert(0, discounted_sum)
        returns_t = torch.tensor(returns, dtype=torch.float32)
        advantages_t = returns_t - values_t
        
        # Normalize advantages
        advantages_t = (advantages_t - advantages_t.mean()) / (advantages_t.std() + 1e-8)
        
        # PPO Update
        for _ in range(4): # 4 PPO epochs
            mu, std = agent.actor(states_t)
            dist = Normal(mu, std)
            log_probs_new = dist.log_prob(actions_t).sum(dim=-1)
            
            ratio = torch.exp(log_probs_new - log_probs_old_t)
            clip_adv = torch.clamp(ratio, 1.0 - clip_ratio, 1.0 + clip_ratio) * advantages_t
            loss_actor = -(torch.min(ratio * advantages_t, clip_adv)).mean()
            
            optimizer_actor.zero_grad()
            loss_actor.backward()
            optimizer_actor.step()
            
            # Critic Update
            val_pred = agent.critic(states_t).squeeze(-1)
            loss_critic = nn.MSELoss()(val_pred, returns_t)
            
            optimizer_critic.zero_grad()
            loss_critic.backward()
            optimizer_critic.step()
            
        if (epoch + 1) % 20 == 0:
            avg_reward = np.mean(rewards)
            print(f"Epoch {epoch+1:3d}/200 | Avg Reward: {avg_reward:6.2f} | Final CPU Temp: {env.cpu_temp:5.1f}°C")
            
    # Save the trained weights!
    agent.save_weights()
    print("Training complete! Weights saved securely.")

if __name__ == "__main__":
    train_ppo()
