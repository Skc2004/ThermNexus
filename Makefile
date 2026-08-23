PREFIX ?= /opt/thermalnexus
SYSTEMD_DIR ?= /etc/systemd/system
POLKIT_DIR ?= /etc/polkit-1/rules.d

.PHONY: build install uninstall dev clean train discover

build:
	cd rust_core && cargo build --release
	cd dashboard && npm ci && npm run build && npm run pack

dev:
	@echo "Start these in separate terminals:"
	@echo "  1. python python/mock_hwmon.py"
	@echo "  2. cd rust_core && cargo run"
	@echo "  3. python python/predictor.py"
	@echo "  4. python python/api_server.py"
	@echo "  5. cd dashboard && npm run dev"

install: build
	@echo "Installing ThermalNexus to $(PREFIX)..."
	sudo mkdir -p $(PREFIX)/{bin,config,python}
	sudo cp rust_core/target/release/thermalnexus-core $(PREFIX)/bin/
	sudo cp -r python/ $(PREFIX)/python/
	sudo cp dashboard/release/*.AppImage $(PREFIX)/bin/ThermalNexus.AppImage
	sudo chmod +x $(PREFIX)/bin/ThermalNexus.AppImage
	sudo cp config.toml $(PREFIX)/config/
	sudo cp bash_scripts/thermalnexus-start.sh $(PREFIX)/bin/
	sudo chmod +x $(PREFIX)/bin/thermalnexus-start.sh
	# systemd
	sudo sed "s|INSTALL_DIR|$(PREFIX)|g" systemd/thermalnexus-core.service | sudo tee $(SYSTEMD_DIR)/thermalnexus-core.service
	sudo sed "s|INSTALL_DIR|$(PREFIX)|g" systemd/thermalnexus-brain.service | sudo tee $(SYSTEMD_DIR)/thermalnexus-brain.service
	sudo systemctl daemon-reload
	# polkit
	sudo cp linux_system/99-thermalnexus.rules $(POLKIT_DIR)/
	@echo "Done. Run: sudo systemctl enable --now thermalnexus-core thermalnexus-brain"

uninstall:
	sudo systemctl stop thermalnexus-core thermalnexus-brain 2>/dev/null || true
	sudo systemctl disable thermalnexus-core thermalnexus-brain 2>/dev/null || true
	sudo rm -f $(SYSTEMD_DIR)/thermalnexus-core.service
	sudo rm -f $(SYSTEMD_DIR)/thermalnexus-brain.service
	sudo rm -f $(POLKIT_DIR)/99-thermalnexus.rules
	sudo rm -rf $(PREFIX)
	sudo systemctl daemon-reload
	@echo "ThermalNexus uninstalled."

train:
	python python/train_model.py

discover:
	python python/hardware_discovery.py

clean:
	cd rust_core && cargo clean
	rm -rf dashboard/dist dashboard/release
