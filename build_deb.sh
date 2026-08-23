#!/bin/bash
set -e

echo "[1/5] Building Rust Daemon..."
cd rust_core
cargo build --release
cd ..

echo "[2/5] Building React AppImage..."
cd dashboard
npm install
npm run build
npm run dist:linux
cd ..

echo "[3/5] Staging files into debian_pkg/opt/thermalnexus..."
PKG_DIR="debian_pkg"
OPT_DIR="$PKG_DIR/opt/thermalnexus"

# Clear old
rm -rf "$OPT_DIR"
mkdir -p "$OPT_DIR/bin"
mkdir -p "$OPT_DIR/python"
mkdir -p "$OPT_DIR/systemd"

# Copy binaries and scripts
cp rust_core/target/release/thermalnexus-core "$OPT_DIR/bin/"
cp -r python/* "$OPT_DIR/python/"
cp systemd/*.service "$OPT_DIR/systemd/"
cp Makefile "$OPT_DIR/"

# Copy AppImage
cp dashboard/dist/*.AppImage "$OPT_DIR/bin/ThermNexus.AppImage" || true

echo "[4/5] Staging postinst scripts..."
cat << 'EOF' > "$PKG_DIR/DEBIAN/postinst"
#!/bin/bash
echo "Installing ThermNexus systemd services..."
cp /opt/thermalnexus/systemd/*.service /etc/systemd/system/
sed -i "s|INSTALL_DIR|/opt/thermalnexus|g" /etc/systemd/system/thermalnexus-core.service
sed -i "s|INSTALL_DIR|/opt/thermalnexus|g" /etc/systemd/system/thermalnexus-brain.service
systemctl daemon-reload
systemctl enable thermalnexus-core thermalnexus-brain
echo "ThermNexus installed successfully!"
EOF
chmod +x "$PKG_DIR/DEBIAN/postinst"

cat << 'EOF' > "$PKG_DIR/DEBIAN/prerm"
#!/bin/bash
echo "Stopping ThermNexus services..."
systemctl stop thermalnexus-core thermalnexus-brain || true
systemctl disable thermalnexus-core thermalnexus-brain || true
rm -f /etc/systemd/system/thermalnexus-core.service
rm -f /etc/systemd/system/thermalnexus-brain.service
systemctl daemon-reload
EOF
chmod +x "$PKG_DIR/DEBIAN/prerm"

echo "[5/5] Building .deb package..."
dpkg-deb --build debian_pkg thermnexus_1.0.0_amd64.deb

echo "Done! Package is ready: thermnexus_1.0.0_amd64.deb"
