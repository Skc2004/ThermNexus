PREFIX ?= /opt/thermalnexus
SYSTEMD_DIR ?= /etc/systemd/system
POLKIT_DIR ?= /etc/polkit-1/rules.d

.PHONY: build install uninstall dev clean train discover

build:
	cd rust_core && cargo build --release
	cd dashboard && npm ci && npm run build

dev:
	@echo "Start these in separate terminals:"
	@echo "  1. python python/mock_hwmon.py"
	@echo "  2. cd rust_core && cargo run"
	@echo "  3. python python/predictor.py"
	@echo "  4. cd dashboard && npm run dev"

install: build
	@echo "Installing ThermalNexus to $(PREFIX)..."
	sudo mkdir -p $(PREFIX)/{bin,config,python,dashboard}
	sudo cp rust_core/target/release/thermalnexus-core $(PREFIX)/bin/
	sudo cp -r python/ $(PREFIX)/python/
	sudo cp -r dashboard/dist/ $(PREFIX)/dashboard/
	sudo cp config.toml $(PREFIX)/config/
	sudo cp bash_scripts/thermalnexus-start.sh $(PREFIX)/bin/
	sudo chmod +x $(PREFIX)/bin/thermalnexus-start.sh
	# systemd
	sudo sed "s|INSTALL_DIR|$(PREFIX)|g" bash_scripts/thermalnexus.service | sudo tee $(SYSTEMD_DIR)/thermalnexus.service
	sudo systemctl daemon-reload
	# polkit
	sudo cp linux_system/99-thermalnexus.rules $(POLKIT_DIR)/
	@echo "Done. Run: sudo systemctl enable --now thermalnexus"

uninstall:
	sudo systemctl stop thermalnexus 2>/dev/null || true
	sudo systemctl disable thermalnexus 2>/dev/null || true
	sudo rm -f $(SYSTEMD_DIR)/thermalnexus.service
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
